// 개발용 데모 데이터.
//
// 화면을 눈으로 확인하려면 "무언가 들어 있는" DB가 아니라 "시각적으로 구분되는
// 상태가 전부 들어 있는" DB가 필요하다. 재생 중 패널, 대기·확인 중 섹션,
// 최근 재생, 매장 TOP, 전체 TOP, 썸네일 fallback, 긴 제목 말줄임, 플랫폼 배지,
// 곡 정규화(같은 곡의 추적 파라미터)까지 한 번에 만든다.
//
// 통합 테스트는 자기 데이터를 따로 만든다. 이 스크립트는 테스트용이 아니라
// 사람과 Playwright가 보는 화면용이다.
//
// 사용: npm run seed:demo --prefix server
const db = require('../src/db/knex');
const { REC_STATUS } = require('../src/constants/recommendation-status');
const { FILTER_STATUS } = require('../src/constants/music-filter-status');
const { PLATFORM } = require('../src/constants/platforms');

const MAIN_SLUG = 'demo';
const OTHER_SLUG = 'demo-other';

/** 운영 DB에 실행되는 것을 막는다. 로컬이 아니면 명시적 동의를 요구한다. */
function assertSafeTarget() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('production에서는 실행하지 않는다.');
  }
  const url = process.env.DATABASE_URL || '';
  const host = (() => {
    try { return new URL(url).hostname; } catch { return ''; }
  })();
  const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(host);
  if (!isLocal && process.env.SEED_DEMO_ALLOW_REMOTE !== 'true') {
    throw new Error(
      `로컬이 아닌 DB(${host})다. 공유 DB일 수 있으므로 중단한다.\n`
      + '정말 필요하면 SEED_DEMO_ALLOW_REMOTE=true 를 붙인다.',
    );
  }
}

const minutesAgo = (m) => new Date(Date.now() - m * 60_000);

// 손님이 곡 링크를 복사해 다시 신청하는 경로가 데모에서도 돌아야 한다. 실재하지
// 않는 video_id를 쓰면 복사된 링크가 형식만 맞는 YouTube 주소가 되고 신청에서
// "영상 정보를 가져올 수 없습니다"로 막힌다. 그래서 실재하는 곡만 쓴다.
//
// SoundCloud·Spotify의 video_id는 운영에서 전체 URL이다(track-metadata.service의
// videoId: trackUrl). 데모도 같은 모양이어야 복사·정규화가 운영과 같게 돈다.
const ytThumb = (id) => `https://img.youtube.com/vi/${id}/mqdefault.jpg`;

const SPOTIFY_REPEATED = 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b';

function rec(cafeId, overrides) {
  return {
    cafe_id: cafeId,
    platform: PLATFORM.YOUTUBE,
    filter_status: FILTER_STATUS.SKIPPED,
    vote_count: 0,
    requested_at: minutesAgo(30),
    ...overrides,
  };
}

/** 곡 행만 만든다. DB를 건드리지 않아 테스트가 그대로 검사할 수 있다. */
function mainCafeRows(cafeId) {
  // 활성 상태는 (cafe_id, video_id) 부분 유니크가 걸려 있어 곡이 겹치면 안 된다.
  const rows = [
    // 재생 중 — 형광 패널 + 핑크 오프셋
    rec(cafeId, {
      video_id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', channel_title: 'Rick Astley',
      status: REC_STATUS.PLAYING, requester_name: '따뜻한 라떼7',
      thumbnail: ytThumb('dQw4w9WgXcQ'),
      requested_at: minutesAgo(4), playing_started_at: minutesAgo(2),
    }),
    // 대기 중 — 자동수락으로 통과한 곡
    rec(cafeId, {
      video_id: 'kJQP7kJhCSQ', title: 'Despacito', channel_title: 'Luis Fonsi',
      status: REC_STATUS.ACCEPTED, filter_status: FILTER_STATUS.ACCEPTED,
      thumbnail: ytThumb('kJQP7kJhCSQ'),
      requester_name: '졸린 스콘42', vote_count: 3, requested_at: minutesAgo(9),
    }),
    // 대기 중 — 썸네일 없음(아이콘 + 선 패턴 fallback). SoundCloud oEmbed가
    // thumbnail_url을 주지 않는 경우라 운영에서도 나오는 상태다.
    rec(cafeId, {
      video_id: 'https://soundcloud.com/forss/flickermood', title: 'Flickermood',
      channel_title: 'Forss', platform: PLATFORM.SOUNDCLOUD,
      status: REC_STATUS.ACCEPTED, filter_status: FILTER_STATUS.ACCEPTED,
      requester_name: '포근한 모카3', requested_at: minutesAgo(14),
    }),
    // 확인 중 — 아주 긴 제목(말줄임 확인). 제목은 실제 트랙명이 아니라 말줄임을
    // 보기 위한 값이다. 이 곡을 복사해 다시 신청하면 실제 제목으로 들어온다.
    rec(cafeId, {
      video_id: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      title: '아주 긴 제목의 곡 — 한 줄에 들어가지 않아 말줄임이 필요한 경우를 확인하기 위한 데모 트랙입니다',
      channel_title: '이름이 긴 아티스트 이름 확인용', platform: PLATFORM.SPOTIFY,
      status: REC_STATUS.PENDING, requester_name: '몽글몽글한 유자차19',
      requested_at: minutesAgo(2),
    }),
    // 확인 중 — 좋아요가 붙은 곡
    rec(cafeId, {
      video_id: '9bZkp7q19f0', title: 'GANGNAM STYLE (강남스타일)', channel_title: 'officialpsy',
      status: REC_STATUS.PENDING, filter_status: FILTER_STATUS.ACCEPTED,
      thumbnail: ytThumb('9bZkp7q19f0'),
      requester_name: '조용한 소금빵88', vote_count: 2, requested_at: minutesAgo(1),
    }),
    // 거절 — AI 필터가 막은 곡(손님 큐에는 안 보인다)
    rec(cafeId, {
      video_id: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody',
      channel_title: 'Queen', status: REC_STATUS.REJECTED,
      thumbnail: ytThumb('fJ9rUzIMcZQ'),
      filter_status: FILTER_STATUS.REJECTED, requested_at: minutesAgo(40),
    }),
  ];

  // 최근 재생 + TOP — 같은 곡을 두 번 재생해 TOP에서 한 행으로 묶이는 것을 본다.
  // 두 번째는 추적 파라미터가 붙어 정규화가 필요하다. Spotify 공유 링크가 실제로
  // ?si=를 달고 오므로 그 플랫폼에 둔다 — YouTube는 파서가 v 파라미터 값만 꺼내므로
  // video_id에 ?가 섞일 수 없다.
  const played = [
    { video_id: 'OPf0YbXqDm0', title: 'Uptown Funk', channel_title: 'Mark Ronson', ago: 70, thumbnail: ytThumb('OPf0YbXqDm0') },
    { video_id: 'RgKAFK5djSk', title: 'See You Again', channel_title: 'Wiz Khalifa', ago: 120, thumbnail: ytThumb('RgKAFK5djSk') },
    { video_id: SPOTIFY_REPEATED, title: 'Blinding Lights', channel_title: 'The Weeknd', ago: 180, platform: PLATFORM.SPOTIFY },
    { video_id: `${SPOTIFY_REPEATED}?si=tracking`, title: 'Blinding Lights', channel_title: 'The Weeknd', ago: 240, platform: PLATFORM.SPOTIFY },
  ];
  for (const { ago, ...song } of played) {
    rows.push(rec(cafeId, {
      ...song,
      status: REC_STATUS.PLAYED, filter_status: FILTER_STATUS.ACCEPTED,
      requested_at: minutesAgo(ago + 5), played_at: minutesAgo(ago),
    }));
  }

  return rows;
}

async function seedMainCafe(trx, cafeId) {
  const inserted = await trx('recommendations').insert(mainCafeRows(cafeId)).returning(['id', 'status']);
  const playing = inserted.find(row => row.status === REC_STATUS.PLAYING);
  await trx('cafes').where({ id: cafeId }).update({ now_playing_id: playing.id });
}

/** 전체 TOP에만 나오는 곡 — 우리 매장에 기록이 없는 곡에도 좋아요를 누를 수 있어야 한다. */
function otherCafeRows(cafeId) {
  return [
    rec(cafeId, {
      video_id: 'YQHsXMglC9A', title: 'Hello',
      channel_title: 'Adele', thumbnail: ytThumb('YQHsXMglC9A'),
      status: REC_STATUS.PLAYED,
      filter_status: FILTER_STATUS.ACCEPTED,
      requested_at: minutesAgo(300), played_at: minutesAgo(295),
    }),
  ];
}

async function seedOtherCafe(trx, cafeId) {
  await trx('recommendations').insert(otherCafeRows(cafeId));
}

/** 표는 (카페, 곡, 방문자) 단위다. 같은 곡의 모든 행이 같은 vote_count를 본다. */
async function seedVotes(trx, cafeId) {
  const voters = ['demo-visitor-a', 'demo-visitor-b', 'demo-visitor-c'];
  await trx('votes').insert(voters.map((visitor_id, i) => ({
    cafe_id: cafeId,
    track_key: SPOTIFY_REPEATED,
    voter_ip: `203.0.113.${i + 1}`,
    visitor_id,
  })));
  await trx('recommendations')
    .where({ cafe_id: cafeId })
    .whereIn('video_id', [SPOTIFY_REPEATED, `${SPOTIFY_REPEATED}?si=tracking`])
    .update({ vote_count: voters.length });
}

async function main() {
  assertSafeTarget();

  await db.transaction(async (trx) => {
    // 다시 실행해도 같은 결과가 되도록 데모 카페만 지우고 새로 만든다.
    // cafes 삭제가 recommendations·votes까지 CASCADE로 정리한다.
    await trx('cafes').whereIn('slug', [MAIN_SLUG, OTHER_SLUG]).delete();

    const [main] = await trx('cafes').insert({
      name: '카페인 플로우 데모', slug: MAIN_SLUG, is_accepting: true,
      notice: '잔잔한 곡 위주로 받고 있어요. 편하게 신청해 주세요.',
    }).returning('*');
    const [other] = await trx('cafes').insert({
      name: '옆집 카페', slug: OTHER_SLUG, is_accepting: true,
    }).returning('*');

    await seedMainCafe(trx, main.id);
    await seedOtherCafe(trx, other.id);
    await seedVotes(trx, main.id);
  });

  console.log(`데모 데이터 준비 완료 — 손님 화면: /${MAIN_SLUG}`);
  console.log(`  재생 중 1곡, 대기 중 2곡, 확인 중 2곡, 최근 재생 4곡, 거절 1곡`);
  console.log(`  전체 TOP 전용 곡은 /${OTHER_SLUG} 매장에 있다`);
}

// 테스트가 곡 목록을 검사하려고 require할 때 시드가 돌면 안 된다.
if (require.main === module) {
  main()
    .then(() => db.destroy())
    .catch(async (error) => {
      console.error(`[seed:demo] ${error.message}`);
      await db.destroy();
      process.exitCode = 1;
    });
}

module.exports = { mainCafeRows, otherCafeRows };
