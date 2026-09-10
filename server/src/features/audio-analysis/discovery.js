const db = require('../../db/knex');
const crypto = require('node:crypto');
const jobs = require('./jobs');
const {
  DISCOVERY_SOURCES, DISCOVERY_MAX_LIMIT, DISCOVERY_LEASE_MINUTES, DISCOVERY_MAX_ATTEMPTS,
} = require('../../constants/audio-discovery');

const conflict = () => Object.assign(new Error('수집 요청이 이미 바뀌었습니다'), { status: 409 });

function validateRequest({ source, query, limit }) {
  if (!DISCOVERY_SOURCES.includes(source)) return { error: '수집 소스가 올바르지 않습니다' };
  if (query !== undefined && query !== null
      && (typeof query !== 'string' || query.length > 200)) {
    return { error: '검색어가 올바르지 않습니다' };
  }
  // SoundCloud는 키워드 검색이라 검색어가 있어야 하고, 차트는 검색어를 쓰지 않는다.
  if (source === 'soundcloud' && !query?.trim()) return { error: 'SoundCloud 수집에는 검색어가 필요합니다' };
  const count = limit === undefined ? 20 : limit;
  if (!Number.isSafeInteger(count) || count < 1 || count > DISCOVERY_MAX_LIMIT) {
    return { error: `수집 개수는 1에서 ${DISCOVERY_MAX_LIMIT} 사이여야 합니다` };
  }
  return { value: { source, query: source === 'soundcloud' ? query.trim() : null, requested_limit: count } };
}

async function request(input) {
  const checked = validateRequest(input);
  if (checked.error) return checked;
  // 같은 소스의 대기 요청이 쌓이면 워커가 같은 차트를 반복해서 훑는다.
  const pending = await db('music_source_discoveries')
    .whereIn('status', ['queued', 'processing']).where({ source: checked.value.source }).first();
  if (pending) return { value: pending, already: true };
  const [row] = await db('music_source_discoveries').insert(checked.value).returning('*');
  return { value: row };
}

function claim() {
  return db.transaction(async (trx) => {
    await trx('music_source_discoveries').where({ status: 'processing' })
      .where('lease_until', '<', trx.fn.now()).update({
        status: trx.raw("CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END", [DISCOVERY_MAX_ATTEMPTS]),
        lease_until: null, error_code: 'LEASE_EXPIRED', updated_at: trx.fn.now(),
      });
    const row = await trx('music_source_discoveries').where({ status: 'queued' })
      .orderBy('created_at').forUpdate().skipLocked().first();
    if (!row) return null;
    const [claimed] = await trx('music_source_discoveries').where({ id: row.id }).update({
      status: 'processing', attempts: row.attempts + 1, lease_token: crypto.randomUUID(),
      lease_until: trx.raw("now() + (? * interval '1 minute')", [DISCOVERY_LEASE_MINUTES]),
      updated_at: trx.fn.now(),
    }).returning('*');
    return claimed;
  });
}

async function locked(trx, id, token) {
  const row = await trx('music_source_discoveries').where({ id }).forUpdate().first();
  if (!row || row.lease_token !== token || row.status !== 'processing') throw conflict();
  return row;
}

// 워커가 찾은 곡을 분석 큐에 넣는다. 중복은 jobs.enqueue의 unique가 무시한다.
function complete(id, token, tracks) {
  return db.transaction(async (trx) => {
    await locked(trx, id, token);
    for (const track of tracks) {
      await jobs.enqueue({
        platform: track.platform, video_id: track.track_key,
        title: track.title, channel_title: track.artist_name,
      }, trx);
    }
    const [row] = await trx('music_source_discoveries').where({ id }).update({
      status: 'done', found_count: tracks.length, enqueued_count: tracks.length,
      lease_token: null, lease_until: null, error_code: null, updated_at: trx.fn.now(),
    }).returning('*');
    return row;
  });
}

function fail(id, token, errorCode) {
  return db.transaction(async (trx) => {
    const row = await locked(trx, id, token);
    const again = row.attempts < DISCOVERY_MAX_ATTEMPTS;
    const [updated] = await trx('music_source_discoveries').where({ id }).update({
      status: again ? 'queued' : 'failed', error_code: errorCode,
      lease_token: null, lease_until: null, updated_at: trx.fn.now(),
    }).returning('*');
    return updated;
  });
}

function recent(limit = 10) {
  return db('music_source_discoveries').orderBy('created_at', 'desc').limit(limit);
}

module.exports = { request, claim, complete, fail, recent, validateRequest };
