/**
 * 매장 생존 신호(last_heartbeat_at) 추가.
 *
 * last_login_at은 "언제 로그인했나"라 매장이 지금 실제로 켜져 있는지 알 수 없다.
 * owner 앱이 이미 /cafe 소켓에 role=owner + JWT로 붙으므로(owner/src/socket.js),
 * 그 연결을 생존 신호로 재사용해 이 컬럼을 갱신한다.
 *
 * 용도:
 *  - 운영자 모니터링에서 활성/휴면 카페 구분
 *  - 가입만 하고 한 번도 켜지 않은 계정(하트비트 NULL) 탐지
 *
 * @param {import('knex').Knex} knex
 */
exports.up = (knex) =>
  knex.schema.alterTable('cafes', (t) => {
    t.timestamp('last_heartbeat_at', { useTz: true }).nullable();
  });

/**
 * @param {import('knex').Knex} knex
 */
exports.down = (knex) =>
  knex.schema.alterTable('cafes', (t) => {
    t.dropColumn('last_heartbeat_at');
  });
