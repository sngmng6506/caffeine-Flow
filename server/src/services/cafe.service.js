const db = require('../db/knex');

const crypto = require('crypto');

function generateSlug() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  // Math.random 대신 crypto — slug는 QR로 공개되는 값이지만 예측 가능할
  // 이유는 없고, randomInt는 모듈로 편향도 없음
  return Array.from({ length: 8 }, () => chars[crypto.randomInt(chars.length)]).join('');
}

async function uniqueSlug() {
  // 36^8 (~2.8조) 공간이라 충돌은 사실상 없지만, DB 오류 등으로
  // findBySlug가 계속 truthy를 반환하는 비정상 상황에서 무한루프 방지
  for (let i = 0; i < 10; i++) {
    const slug = generateSlug();
    if (!(await findBySlug(slug))) return slug;
  }
  throw new Error('slug 생성 실패 — 10회 연속 충돌 (DB 상태 확인 필요)');
}

async function findBySlug(slug) {
  return db('cafes').where({ slug }).first();
}

async function findByEmail(email) {
  return db('cafes').where({ owner_email: email }).first();
}

async function findByGoogleId(googleId) {
  return db('cafes').where({ google_id: googleId }).first();
}

async function findByNaverId(naverId) {
  return db('cafes').where({ naver_id: naverId }).first();
}

async function create({ name, ownerEmail, googleId, naverId, disclaimerAcceptedAt, lastLoginAt, agreements, location }) {
  const slug = await uniqueSlug();
  const now = new Date();
  const [cafe] = await db('cafes')
    .insert({
      name,
      slug,
      owner_email:            ownerEmail            || null,
      google_id:              googleId              || null,
      naver_id:               naverId               || null,
      disclaimer_accepted_at: disclaimerAcceptedAt  || null,
      last_login_at:          lastLoginAt           || null,
      terms_agreed_at:        agreements?.service    ? now : null,
      privacy_agreed_at:      agreements?.privacy    ? now : null,
      copyright_agreed_at:    agreements?.copyright  ? now : null,
      age_confirmed_at:       agreements?.age        ? now : null,
      marketing_agreed:       !!agreements?.marketing,
      marketing_agreed_at:    agreements?.marketing  ? now : null,
      region:                 location?.region       || null,
      district:               location?.district     || null,
      dong:                   location?.dong         || null,
      latitude:               location?.latitude     || null,
      longitude:              location?.longitude    || null,
    })
    .returning('*');
  return cafe;
}

async function update(id, data) {
  const [cafe] = await db('cafes').where({ id }).update(data).returning('*');
  return cafe;
}

// slug 변경 — 자동 재발급(무작위) 또는 수동 지정(아크릴 QR 재등록) 모두 처리.
// 트랜잭션으로 이력 기록과 갱신을 묶어 부분 실패를 막는다.
async function changeSlug(cafeId, newSlug) {
  return db.transaction(async (trx) => {
    const cafe = await trx('cafes').where({ id: cafeId }).first();
    if (!cafe) throw Object.assign(new Error('카페를 찾을 수 없습니다'), { status: 404 });

    const conflict = await trx('cafes').where({ slug: newSlug }).first();
    if (conflict) throw Object.assign(new Error('이미 사용 중인 QR 코드입니다'), { status: 409 });

    await trx('cafe_slug_history').insert({ cafe_id: cafeId, old_slug: cafe.slug, new_slug: newSlug });
    const [updated] = await trx('cafes').where({ id: cafeId }).update({ slug: newSlug }).returning('*');
    return updated;
  });
}

// slug 형식 검증 — 커스텀 지정(아크릴 QR 재등록) 시 서버가 생성하는 것과
// 동일한 문자집합·길이만 허용한다. 다른 형식을 허용하면 URL에 안전하지
// 않은 문자가 들어가거나, 기존 라우트 패턴(:slug)과 충돌할 수 있다.
const SLUG_PATTERN = /^[a-z0-9]{4,20}$/;

function isValidSlugFormat(slug) {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug);
}

// 옛 slug로 접속한 손님에게 "이동됨" 안내를 하기 위한 조회.
//
// 체인 추적(old_slug→new_slug 반복) 대신 카페 소유권으로 해석한다:
// 옛 slug를 마지막으로 사용했던 카페를 이력에서 찾고(가장 최근 변경),
// 그 카페의 *현재* slug(cafes 테이블 기준)를 돌려준다. 이렇게 하면
//  - slug 재사용(버려진 slug를 다른 카페가 가져감): 이력의 new_slug가
//    아니라 카페의 실제 현재 slug를 보므로 항상 정확
//  - 순환(A→B→A): 카페 하나의 현재 slug로 수렴하므로 왕복 안 함
// 이력에 old_slug가 없거나, 그 카페의 현재 slug가 조회한 slug와 같으면
// (이동한 적 없음) null.
async function findMovedSlug(oldSlug) {
  const entry = await db('cafe_slug_history')
    .where({ old_slug: oldSlug })
    .orderBy('changed_at', 'desc')
    .first();
  if (!entry) return null;

  const cafe = await db('cafes').where({ id: entry.cafe_id }).first();
  if (!cafe || cafe.slug === oldSlug) return null; // 카페 삭제됐거나 되돌아왔음
  return cafe.slug;
}

module.exports = { findBySlug, findByEmail, findByGoogleId, findByNaverId, create, update, uniqueSlug, isValidSlugFormat, changeSlug, findMovedSlug };
