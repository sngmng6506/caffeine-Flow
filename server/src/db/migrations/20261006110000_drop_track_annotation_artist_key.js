// music_track_annotations.artist_key 제거 2단계: 칸을 지운다.
//
// 1단계(20261006100000)를 담은 코드가 배포된 뒤에 적용한다. 그 코드는 artist_key를
// 쓰지 않으므로, 이 마이그레이션이 도는 동안 옛 코드가 요청을 받아도 깨지지 않는다.
// 아티스트명(artist_name)은 남는다. 키가 다시 필요하면 이름에서 계산하면 된다.
exports.up = async function (knex) {
  await knex.schema.alterTable('music_track_annotations', (table) => {
    table.dropColumn('artist_key');
  });
};

// 1단계 직후 상태(칸 있음, NULL 허용, 인덱스 없음)로 되돌리고 이름에서 키를 채운다.
// 계산식은 이 커밋 시점 annotation.js의 normalizeArtistKey를 그대로 옮겼다. 앱 코드를
// 불러오지 않는 것은 나중에 그 함수가 바뀌어도 이 마이그레이션의 의미가 바뀌지 않게
// 하기 위해서다.
function normalizeArtistKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+-\s+topic$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

exports.down = async function (knex) {
  await knex.schema.alterTable('music_track_annotations', (table) => {
    table.string('artist_key', 200).nullable();
  });
  const rows = await knex('music_track_annotations').select('id', 'artist_name');
  for (const row of rows) {
    await knex('music_track_annotations')
      .where({ id: row.id })
      .update({ artist_key: normalizeArtistKey(row.artist_name) });
  }
};
