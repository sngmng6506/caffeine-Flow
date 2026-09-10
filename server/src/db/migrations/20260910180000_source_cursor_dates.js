// 날짜 기반 소스(MusicBrainz)는 순위 offset으로 진도를 잡을 수 없다. 상대적인
// "며칠 전"을 쓰면 한동안 버튼을 안 누른 사이에 나온 곡이 통째로 빠진다.
// 어디까지 훑었는지 절대 날짜로 남긴다.
exports.up = async (knex) => {
  await knex.schema.alterTable('music_source_cursors', (t) => {
    t.date('covered_from');
    t.date('covered_to');
  });
};
exports.down = async (knex) => {
  await knex.schema.alterTable('music_source_cursors', (t) => t.dropColumns('covered_from', 'covered_to'));
};
