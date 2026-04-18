exports.up = async function (knex) {
  await knex.schema.alterTable('cafes', (t) => {
    t.string('address', 255).nullable();        // 지번 주소
    t.string('road_address', 255).nullable();    // 도로명 주소
    t.string('region', 50).nullable();           // 시/도
    t.string('district', 50).nullable();         // 시/군/구
    t.decimal('latitude', 10, 7).nullable();     // 위도
    t.decimal('longitude', 11, 7).nullable();    // 경도
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('cafes', (t) => {
    t.dropColumn('address');
    t.dropColumn('road_address');
    t.dropColumn('region');
    t.dropColumn('district');
    t.dropColumn('latitude');
    t.dropColumn('longitude');
  });
};
