require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('./src/db/knex');

async function test() {
  console.log('\n=== 댓글 DB 확인 ===\n');

  const comments = await db('song_comments as sc')
    .leftJoin('cafes as c', 'sc.cafe_id', 'c.id')
    .select(
      'sc.id', 'sc.video_id', 'sc.body', 'sc.commenter_name',
      'sc.parent_id', 'sc.created_at', 'c.name as cafe_name'
    )
    .orderBy('sc.created_at', 'desc')
    .limit(20);

  if (comments.length === 0) {
    console.log('저장된 댓글 없음');
  } else {
    console.log(`총 ${comments.length}개 (최근 20개)\n`);
    comments.forEach(c => {
      const type = c.parent_id ? '  └ 대댓글' : '댓글';
      console.log(`${type} | video: ${c.video_id} | "${c.body}" | ${c.commenter_name ?? '익명'} | ${c.cafe_name ?? '전체TOP'} | ${new Date(c.created_at).toLocaleString('ko-KR')}`);
    });
  }

  const total      = await db('song_comments').whereNull('parent_id').count('id as n').first();
  const replies    = await db('song_comments').whereNotNull('parent_id').count('id as n').first();
  const cafeComments  = await db('song_comments').whereNotNull('cafe_id').count('id as n').first();
  const globalComments = await db('song_comments').whereNull('cafe_id').count('id as n').first();

  console.log(`\n[ 요약 ]`);
  console.log(`  댓글: ${total.n}개 / 대댓글: ${replies.n}개`);
  console.log(`  카페 TOP: ${cafeComments.n}개 / 전체 TOP: ${globalComments.n}개`);

  process.exit(0);
}

test().catch(e => { console.error(e); process.exit(1); });
