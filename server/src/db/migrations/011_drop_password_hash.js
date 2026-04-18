exports.up = function (knex) {
  return knex.schema.alterTable('cafes', (t) => {
    t.dropColumn('password_hash');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('cafes', (t) => {
    t.string('password_hash', 255).nullable();
  });
};
