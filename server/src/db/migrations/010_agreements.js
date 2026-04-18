exports.up = function (knex) {
  return knex.schema.alterTable('cafes', (t) => {
    t.timestamp('terms_agreed_at').nullable();
    t.timestamp('privacy_agreed_at').nullable();
    t.timestamp('copyright_agreed_at').nullable();
    t.boolean('marketing_agreed').defaultTo(false);
    t.timestamp('marketing_agreed_at').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('cafes', (t) => {
    t.dropColumn('terms_agreed_at');
    t.dropColumn('privacy_agreed_at');
    t.dropColumn('copyright_agreed_at');
    t.dropColumn('marketing_agreed');
    t.dropColumn('marketing_agreed_at');
  });
};
