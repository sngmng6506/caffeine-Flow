/**
 * 통계 테스트용 시드 데이터
 * 실행: node seed-test.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('./src/db/knex');

const SONGS = [
  { videoId: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up', channelTitle: 'Rick Astley' },
  { videoId: '9bZkp7q19f0', title: 'PSY - GANGNAM STYLE(강남스타일)', channelTitle: 'officialpsy' },
  { videoId: 'JGwWNGJdvx8', title: 'Ed Sheeran - Shape of You', channelTitle: 'Ed Sheeran' },
  { videoId: 'kXYiU_JCYtU', title: 'Linkin Park - Numb', channelTitle: 'Linkin Park' },
  { videoId: 'fJ9rUzIMcZQ', title: 'Queen - Bohemian Rhapsody', channelTitle: 'Queen Official' },
  { videoId: 'hT_nvWreIhg', title: 'OneRepublic - Counting Stars', channelTitle: 'OneRepublic' },
  { videoId: 'YqeW9_5kURI', title: "Justin Timberlake - Can't Stop the Feeling", channelTitle: 'Justin Timberlake' },
  { videoId: 'CevxZvSJLk8', title: 'Katy Perry - Roar', channelTitle: 'Katy Perry' },
  { videoId: 'pRpeEdMmmQ0', title: 'Shakira - Waka Waka', channelTitle: 'Shakira' },
  { videoId: 'OPf0YbXqDm0', title: 'Mark Ronson - Uptown Funk ft. Bruno Mars', channelTitle: 'Mark Ronson' },
];

function thumbnail(videoId) {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

// 최근 7일 + 다양한 시간대에 걸쳐 데이터 생성
function makeDate(daysAgo, hour) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
  return d;
}

const TEST_RECS = [
  // 오늘 (다양한 상태)
  { song: 0, daysAgo: 0, hour: 10, status: 'played',   votes: 3 },
  { song: 1, daysAgo: 0, hour: 11, status: 'played',   votes: 5 },
  { song: 2, daysAgo: 0, hour: 12, status: 'played',   votes: 2 },
  { song: 3, daysAgo: 0, hour: 13, status: 'skipped',  votes: 1 },
  { song: 4, daysAgo: 0, hour: 14, status: 'played',   votes: 4 },
  { song: 5, daysAgo: 0, hour: 15, status: 'rejected', votes: 0 },
  { song: 6, daysAgo: 0, hour: 19, status: 'played',   votes: 6 },
  { song: 7, daysAgo: 0, hour: 20, status: 'played',   votes: 3 },
  { song: 8, daysAgo: 0, hour: 20, status: 'skipped',  votes: 2 },
  { song: 9, daysAgo: 0, hour: 21, status: 'pending',  votes: 1 },

  // 어제
  { song: 0, daysAgo: 1, hour:  9, status: 'played',  votes: 2 },
  { song: 2, daysAgo: 1, hour: 13, status: 'played',  votes: 4 },
  { song: 4, daysAgo: 1, hour: 18, status: 'played',  votes: 3 },
  { song: 6, daysAgo: 1, hour: 20, status: 'skipped', votes: 1 },
  { song: 8, daysAgo: 1, hour: 21, status: 'played',  votes: 5 },

  // 2일 전
  { song: 1, daysAgo: 2, hour: 12, status: 'played',  votes: 3 },
  { song: 3, daysAgo: 2, hour: 14, status: 'played',  votes: 2 },
  { song: 5, daysAgo: 2, hour: 19, status: 'played',  votes: 4 },
  { song: 7, daysAgo: 2, hour: 21, status: 'skipped', votes: 1 },

  // 3일 전
  { song: 0, daysAgo: 3, hour: 11, status: 'played',  votes: 2 },
  { song: 2, daysAgo: 3, hour: 15, status: 'played',  votes: 3 },
  { song: 4, daysAgo: 3, hour: 20, status: 'played',  votes: 5 },

  // 4~6일 전
  { song: 1, daysAgo: 4, hour: 13, status: 'played',  votes: 2 },
  { song: 3, daysAgo: 4, hour: 19, status: 'played',  votes: 3 },
  { song: 5, daysAgo: 5, hour: 12, status: 'played',  votes: 1 },
  { song: 7, daysAgo: 5, hour: 20, status: 'skipped', votes: 2 },
  { song: 9, daysAgo: 6, hour: 14, status: 'played',  votes: 4 },
  { song: 0, daysAgo: 6, hour: 18, status: 'played',  votes: 3 },
];

async function seed() {
  const slug = process.argv[2];
  const cafe = slug
    ? await db('cafes').where({ slug }).first()
    : await db('cafes').first();

  if (!cafe) {
    console.error(slug ? `slug "${slug}" 에 해당하는 카페가 없습니다.` : '카페가 없습니다.');
    process.exit(1);
  }

  console.log(`카페: ${cafe.name} (${cafe.slug})`);

  const rows = TEST_RECS.map(r => {
    const song = SONGS[r.song];
    const date = makeDate(r.daysAgo, r.hour);
    return {
      cafe_id:       cafe.id,
      video_id:      song.videoId,
      title:         song.title,
      channel_title: song.channelTitle,
      thumbnail:     thumbnail(song.videoId),
      status:        r.status,
      vote_count:    r.votes,
      requested_at:  date,
      played_at:     r.status === 'played' ? date : null,
    };
  });

  await db('recommendations').insert(rows);
  console.log(`✅ ${rows.length}개 레코드 삽입 완료`);
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
