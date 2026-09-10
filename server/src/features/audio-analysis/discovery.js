const { isDeepStrictEqual } = require('node:util');
const db = require('../../db/knex');
const crypto = require('node:crypto');
const jobs = require('./jobs');
const window = require('./discovery-window');
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
    // 같은 소스의 페이지를 두 워커가 동시에 처리하지 않도록 claim을 직렬화한다.
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext('audio-discovery-claim'))");
    await trx('music_source_discoveries').where({ status: 'processing' })
      .where('lease_until', '<', trx.fn.now()).update({
        status: trx.raw("CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END", [DISCOVERY_MAX_ATTEMPTS]),
        lease_until: null, error_code: 'LEASE_EXPIRED', updated_at: trx.fn.now(),
      });
    const row = await trx('music_source_discoveries').where({ status: 'queued' })
      .whereNotIn('source', trx('music_source_discoveries').select('source').where({ status: 'processing' }))
      .orderBy('created_at').forUpdate().skipLocked().first();
    if (!row) return null;
    const [claimed] = await trx('music_source_discoveries').where({ id: row.id }).update({
      status: 'processing', attempts: row.attempts + 1, lease_token: crypto.randomUUID(),
      lease_until: trx.raw("now() + (? * interval '1 minute')", [DISCOVERY_LEASE_MINUTES]),
      updated_at: trx.fn.now(),
    }).returning('*');
    // 어디서부터 가져올지 알려준다. 같은 구간을 반복해서 훑지 않기 위해서다.
    const cursor = await trx('music_source_cursors')
      .select('*', trx.raw('covered_from::text as covered_from, covered_to::text as covered_to'))
      .where({ source: claimed.source, query_key: claimed.query || '' }).first();
    if (window.isDateWindowSource(claimed.source)) {
      // 미완료 날짜 구간과 원본 페이지 위치를 함께 이어받는다.
      const pageWindow = cursor?.pending_window || window.nextWindow(cursor, new Date());
      const offset = cursor?.pending_window ? cursor.next_offset : 0;
      await trx('music_source_discoveries').where({ id: row.id }).update({ claimed_window: pageWindow ? JSON.stringify(pageWindow) : null, claimed_offset: offset });
      return { ...claimed, window: pageWindow, offset, page_schema_version: 1 };
    }
    return { ...claimed, offset: cursor ? cursor.next_offset : 0 };
  });
}

async function locked(trx, id, token) {
  const row = await trx('music_source_discoveries').where({ id }).forUpdate().first();
  if (!row || row.lease_token !== token || row.status !== 'processing') throw conflict();
  return row;
}

// 워커가 찾은 곡을 분석 큐에 넣고 소스 진도를 옮긴다. 중복은 jobs.enqueue가 무시한다.
function complete(id, token, tracks, meta = {}) {
  return db.transaction(async (trx) => {
    const request = await locked(trx, id, token);
    if (window.isDateWindowSource(request.source) && (meta.page_schema_version !== 1 ||
        !Number.isSafeInteger(meta.scanned) || meta.scanned < 0 || meta.scanned > request.requested_limit ||
        meta.offset !== request.claimed_offset || !isDeepStrictEqual(meta.window ?? null, request.claimed_window) ||
        tracks.length > meta.scanned)) {
      throw Object.assign(new Error('수집 페이지가 claim 정보와 다릅니다. 워커 버전을 확인해주세요.'), { status: 400 });
    }
    let added = 0;
    for (const track of tracks) {
      const inserted = await jobs.enqueue({
        platform: track.platform, video_id: track.track_key,
        title: track.title, channel_title: track.artist_name,
      }, trx);
      if (inserted) added += 1;
    }

    // 다음 요청은 이번에 훑은 구간 다음부터 본다. 소스가 바닥나면 처음으로 돌아가
    // 그 사이 바뀐 차트를 다시 본다. offset은 워커가 실제로 사용한 값을 신뢰한다.
    const key = { source: request.source, query_key: request.query || '' };
    const cursor = await trx('music_source_cursors')
      .select('*', trx.raw('covered_from::text as covered_from, covered_to::text as covered_to'))
      .where(key).first();
    let next;
    if (window.isDateWindowSource(request.source)) {
      // 창을 못 받았으면 백필 하한에 닿은 것이라 커서를 그대로 둔다.
      if (request.claimed_window) {
        next = meta.scanned < request.requested_limit
          ? { ...window.advance(cursor, request.claimed_window), pending_window: null, next_offset: 0 }
          : { pending_window: JSON.stringify(request.claimed_window), next_offset: request.claimed_offset + meta.scanned };
      } else next = null;
    } else {
      const positive = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
      const usedOffset = positive(meta.offset) ?? 0;
      const scanned = positive(meta.scanned) ?? tracks.length;
      next = { next_offset: scanned < request.requested_limit ? 0 : usedOffset + request.requested_limit };
    }
    if (next) {
      await trx('music_source_cursors').insert({ ...key, ...next, updated_at: trx.fn.now() })
        .onConflict(['source', 'query_key']).merge({ ...next, updated_at: trx.fn.now() });
    }

    const [row] = await trx('music_source_discoveries').where({ id }).update({
      status: 'done', found_count: tracks.length, enqueued_count: added,
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
