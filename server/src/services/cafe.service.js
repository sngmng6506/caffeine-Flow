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
      address:                location?.address      || null,
      road_address:           location?.roadAddress  || null,
      region:                 location?.region       || null,
      district:               location?.district     || null,
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

module.exports = { findBySlug, findByEmail, findByGoogleId, findByNaverId, create, update };
