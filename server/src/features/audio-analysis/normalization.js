// 장르를 판단할 모델이 없으므로 접을 택소노미도 없다. 빈 배열이면 unknown으로
// 표시하되, 저장하는 normalized.genre 자체는 비워 둔다 — "모른다"와 "판단할 모델이
// 돌지 않았다"를 구분하기 위해서다.
function genreTags(normalized) {
  return normalized.genre.length ? normalized.genre.map((v) => v.label) : ['unknown'];
}

module.exports = { genreTags };
