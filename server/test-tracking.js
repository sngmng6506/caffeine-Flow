/**
 * 트래킹 기능 테스트
 * 실행: node test-tracking.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('./src/db/knex');

async function test() {
  console.log('\n=== 트래킹 기능 테스트 ===\n');

  // 1. 컬럼 존재 여부 확인
  console.log('[ 1. 마이그레이션 확인 ]');
  const hasCafeVisits = await db.schema.hasTable('cafe_visits');
  const hasLastLogin  = await db.schema.hasColumn('cafes', 'last_login_at');
  console.log(`  cafe_visits 테이블: ${hasCafeVisits ? '✅' : '❌'}`);
  console.log(`  cafes.last_login_at 컬럼: ${hasLastLogin ? '✅' : '❌'}`);

  if (!hasCafeVisits || !hasLastLogin) {
    console.log('\n❌ 마이그레이션이 실행되지 않았습니다. npm run migrate 를 먼저 실행해주세요.');
    process.exit(1);
  }

  // 2. 카페 목록 + last_login_at 확인
  console.log('\n[ 2. 카페별 로그인 기록 ]');
  const cafes = await db('cafes').select('name', 'slug', 'created_at', 'last_login_at');
  if (cafes.length === 0) {
    console.log('  등록된 카페 없음');
  } else {
    cafes.forEach(c => {
      console.log(`  ${c.name} (${c.slug})`);
      console.log(`    가입일:       ${c.created_at}`);
      console.log(`    마지막 로그인: ${c.last_login_at ?? '❌ 기록 없음 (로그인 필요)'}`);
    });
  }

  // 3. 방문 기록 확인
  console.log('\n[ 3. 카페별 방문 기록 ]');
  const visits = await db('cafe_visits as v')
    .join('cafes as c', 'v.cafe_id', 'c.id')
    .select('c.name', 'c.slug')
    .count('v.id as total_visits')
    .select(db.raw('COUNT(DISTINCT COALESCE(v.visitor_id, v.visitor_ip::text)) AS unique_browsers'))
    .where('v.visited_at', '>=', db.raw("NOW() - INTERVAL '7 days'"))
    .groupBy('c.id', 'c.name', 'c.slug');

  if (visits.length === 0) {
    console.log('  방문 기록 없음 (손님 페이지 접속 필요)');
  } else {
    visits.forEach(v => {
      console.log(`  ${v.name}: 최근 7일 ${v.total_visits} 브라우저-일 / ${v.unique_browsers} 익명 브라우저`);
    });
  }

  // 4. 오늘 방문 기록 상세
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayVisits = await db('cafe_visits').where('visited_at', '>=', today).count('id as n').first();
  console.log(`\n[ 4. 오늘 전체 카페 방문 레코드: ${todayVisits.n}건 ]`);

  console.log('\n=== 완료 ===\n');
  process.exit(0);
}

test().catch(e => { console.error(e); process.exit(1); });
