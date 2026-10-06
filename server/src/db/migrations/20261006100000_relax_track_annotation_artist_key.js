// music_track_annotations.artist_key 제거 1단계: 쓰지 않아도 되게 푼다.
//
// artist_key는 아티스트명을 다듬은 검색용 키다. 읽는 곳은 아티스트 참고 API뿐이었고
// 62ef229에서 지웠다. 이 마이그레이션과 같이 배포되는 코드는 더 이상 키를 쓰지 않는다.
//
// 칸을 바로 지우지 않는 이유: 배포는 마이그레이션을 먼저 돌리고 그동안 옛 코드가
// 요청을 계속 받는다. 칸이 사라지면 그 사이 옛 코드의 라벨 저장(워커 분석 완료,
// lab 검토)이 artist_key를 쓰다 실패한다. 그래서 이번에는 NOT NULL과 인덱스만 풀고,
// 칸은 이 코드가 배포된 뒤 다음 마이그레이션에서 지운다.
exports.up = async function (knex) {
  await knex.schema.alterTable('music_track_annotations', (table) => {
    table.dropIndex(['artist_key', 'updated_at']);
    table.setNullable('artist_key');
  });
};

// 되돌릴 때는 artist_name에서 키를 다시 계산해 모든 행을 채운다. 이 단계 이후 저장된
// 행은 키가 비어 있고, 이름이 바뀐 행은 옛 키가 남아 있을 수 있어서다.
//
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
  const rows = await knex('music_track_annotations').select('id', 'artist_name');
  for (const row of rows) {
    await knex('music_track_annotations')
      .where({ id: row.id })
      .update({ artist_key: normalizeArtistKey(row.artist_name) });
  }
  await knex.schema.alterTable('music_track_annotations', (table) => {
    table.dropNullable('artist_key');
    table.index(['artist_key', 'updated_at']);
  });
};
