/**
 * slug 변경 이력 — "아크릴 QR 재등록" 기능 지원.
 *
 * 사장님이 미리 제작된 QR(다른 slug)로 카페를 재연결하거나, 임의로 새
 * slug를 발급받을 수 있게 되면서 slug가 더 이상 불변이 아니게 된다.
 * 옛 QR을 스캔한 손님이 "이 카페를 찾을 수 없습니다"를 만났을 때
 * 원인을 추적할 수 있도록 변경 이력을 남긴다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = (knex) =>
  knex.schema.createTable('cafe_slug_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('cafe_id').notNullable().references('id').inTable('cafes').onDelete('CASCADE');
    t.string('old_slug', 20).notNullable();
    t.string('new_slug', 20).notNullable();
    t.timestamp('changed_at').notNullable().defaultTo(knex.fn.now());
    t.index(['old_slug']); // 옛 QR로 접속 시 "이동됨" 안내에 사용
  });

/**
 * @param {import('knex').Knex} knex
 */
exports.down = (knex) => knex.schema.dropTableIfExists('cafe_slug_history');
