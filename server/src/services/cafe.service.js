const db = require('../db/knex');

async function findBySlug(slug) {
  return db('cafes').where({ slug }).first();
}

async function findByEmail(email) {
  return db('cafes').where({ owner_email: email }).first();
}

async function create({ name, slug, ownerEmail, passwordHash }) {
  const [cafe] = await db('cafes')
    .insert({ name, slug, owner_email: ownerEmail, password_hash: passwordHash })
    .returning('*');
  return cafe;
}

async function update(id, data) {
  const [cafe] = await db('cafes').where({ id }).update(data).returning('*');
  return cafe;
}

module.exports = { findBySlug, findByEmail, create, update };
