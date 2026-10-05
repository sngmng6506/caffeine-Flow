const crypto = require('crypto');
const db = require('../../db/knex');
const { KST_VISIT_DATE_SQL } = require('../../db/sql-fragments');
const { PUBLIC_GUIDE_LIMIT } = require('../../constants/limits');
const { MUSIC_FILTER_TIMEOUT_MS } = require('../../config');

const exhausted = () => Object.assign(new Error('오늘 AI 안내 생성 한도를 모두 사용했습니다. 기존 설명으로 필터를 끄거나 안내를 직접 수정할 수 있습니다.'), { status: 429 });

// 외부 호출 전에 영속 예산을 예약한다. 실패도 과금될 수 있어 반환하지 않는다.
// global → cafe 순서의 짧은 행 잠금만 사용하고, LLM을 기다리며 DB를 잡지 않는다.
async function reserve(cafeId) {
  const scope = `cafe:${cafeId}`;
  const token = crypto.randomUUID();
  return db.transaction(async trx => {
    for (const key of ['global', scope]) {
      await trx('public_guide_usage').insert({ scope: key, usage_date: trx.raw(KST_VISIT_DATE_SQL) })
        .onConflict('scope').ignore();
    }
    const global = await trx('public_guide_usage').where({ scope: 'global' }).select('*', trx.raw('usage_date::text AS usage_day')).forUpdate().first();
    const cafe = await trx('public_guide_usage').where({ scope }).select('*', trx.raw('usage_date::text AS usage_day')).forUpdate().first();
    // 날짜·lease 모두 DB 시각 기준. 인스턴스 시계나 프로세스 재시작에 의존하지 않는다.
    const { rows: [clock] } = await trx.raw(`SELECT ${KST_VISIT_DATE_SQL}::text AS today, now() AS now`);
    const used = row => row.usage_day === clock.today ? row.attempts : 0;
    if (cafe.lease_until && new Date(cafe.lease_until) > new Date(clock.now)) {
      throw Object.assign(new Error('AI 안내를 생성하고 있습니다. 잠시 후 다시 시도해주세요.'), { status: 409 });
    }
    if (used(cafe) >= PUBLIC_GUIDE_LIMIT.cafeDaily || used(global) >= PUBLIC_GUIDE_LIMIT.globalDaily) throw exhausted();
    for (const row of [global, cafe]) {
      await trx('public_guide_usage').where({ scope: row.scope }).update({
        usage_date: clock.today, attempts: used(row) + 1,
        ...(row.scope === scope ? {
          lease_token: token,
          lease_until: trx.raw("now() + (? * interval '1 millisecond')", [MUSIC_FILTER_TIMEOUT_MS + PUBLIC_GUIDE_LIMIT.leaseGraceMs]),
        } : {}),
      });
    }
    return { scope, token };
  });
}

async function release(ticket) {
  if (!ticket) return;
  await db('public_guide_usage').where({ scope: ticket.scope, lease_token: ticket.token })
    .update({ lease_token: null, lease_until: null });
}

module.exports = { reserve, release };
