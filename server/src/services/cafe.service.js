const db = require('../db/knex');

function generateSlug() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function uniqueSlug() {
  let slug;
  do { slug = generateSlug(); } while (await findBySlug(slug));
  return slug;
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
