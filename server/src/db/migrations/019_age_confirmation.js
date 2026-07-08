/**
 * 만 14세 이상 확인 시각 기록.
 *
 * 개인정보보호법상 만 14세 미만 아동은 법정대리인 동의가 필요하므로,
 * 가입 시 "만 14세 이상" 확인을 필수 동의 항목으로 받고 그 시각을
 * 증빙으로 남긴다 (기존 terms/privacy/copyright_agreed_at과 동일 패턴).
 *
 * 기존 회원은 null 유지 — 소급 확인이 불가능하므로 기록하지 않는다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = (knex) =>
  knex.schema.alterTable('cafes', (t) => {
    t.timestamp('age_confirmed_at').nullable();
  });

/**
 * @param {import('knex').Knex} knex
 */
exports.down = (knex) =>
  knex.schema.alterTable('cafes', (t) => {
    t.dropColumn('age_confirmed_at');
  });
