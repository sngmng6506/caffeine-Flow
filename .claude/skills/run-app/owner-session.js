// 사장님 화면은 Google·Naver OAuth를 타야 들어갈 수 있다. 브라우저에서 그 흐름을
// 대신할 수 없으므로, 서버가 로그인 성공 시 내려주는 것과 같은 토큰과 카페 정보를
// 만들어 둔다. 화면은 이 둘을 localStorage에서 복원한다(LoginPage.jsx 참고).
//
// 실행: node .claude/skills/run-app/owner-session.js <슬러그> <출력폴더>
// 결과: <출력폴더>/owner-session.json  { token, cafe }
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
// 의존성은 server/node_modules에만 있다. 스킬 폴더에서 그냥 require하면 못 찾는다.
const fromServer = (name) => require(path.join(root, 'server/node_modules', name));
fromServer('dotenv').config({ path: path.join(root, '.env') });

const slug = process.argv[2] || 'demo';
const outDir = process.argv[3];
if (!outDir) {
  console.error('출력 폴더를 인자로 준다');
  process.exit(1);
}

const db = require(path.join(root, 'server/src/db/knex'));
const { issueToken } = require(path.join(root, 'server/src/utils/jwt'));

db('cafes').where({ slug }).first()
  .then((cafe) => {
    if (!cafe) throw new Error(`카페 ${slug}가 없다. npm run seed:demo --prefix server를 먼저 실행한다`);
    // 화면이 쓰는 필드만 담는다 — 공개 응답 경계와 같은 모양이다.
    const session = {
      token: issueToken(cafe),
      cafe: {
        id: cafe.id,
        name: cafe.name,
        slug: cafe.slug,
        is_accepting: cafe.is_accepting,
        allowed_platforms: cafe.allowed_platforms,
        music_filter_enabled: cafe.music_filter_enabled,
      },
    };
    fs.writeFileSync(path.join(outDir, 'owner-session.json'), JSON.stringify(session));
    return db.destroy();
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
    return db.destroy();
  });
