/**
 * DB 정리 + 최신 한국 노래로 시드
 *
 * 실행:
 *   node server/src/scripts/seed_songs.js
 *
 * 동작:
 *   1) recommendations / votes / comments / song_comments(+replies) / daily_stats 모두 삭제
 *   2) YouTube Data API로 최신 K-pop 검색어 몇 개 돌려서 20~30곡 수집
 *   3) 각 카페별로 'played' 상태로 history에 뿌려넣기
 *   4) cafes.now_playing_id 는 초기화
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const db = require('../db/knex');

// 한국 인기곡 시드 — 유명 K-pop 위주 (썸네일이 깨지면 해당 항목만 수정)
const SEED_SONGS = [
  { video_id: 'gdZLi9oWNZg', title: 'BTS (방탄소년단) "Dynamite" Official MV',              channel_title: 'HYBE LABELS', duration: '3:43' },
  { video_id: 'WMweEpGlu_U', title: 'BTS (방탄소년단) "Butter" Official MV',                channel_title: 'HYBE LABELS', duration: '3:55' },
  { video_id: 'XsX3ATc3FbA', title: 'BTS (방탄소년단) "작은 것들을 위한 시 (Boy With Luv) feat. Halsey" Official MV', channel_title: 'HYBE LABELS', duration: '4:13' },
  { video_id: 'ioNng23DkIM', title: 'BLACKPINK - "How You Like That" M/V',                  channel_title: 'BLACKPINK',  duration: '3:12' },
  { video_id: 'IHNzOHi8sJs', title: 'BLACKPINK - "뚜두뚜두 (DDU-DU DDU-DU)" M/V',            channel_title: 'BLACKPINK',  duration: '3:33' },
  { video_id: '2S24-y0Ij3Y', title: 'BLACKPINK - "Kill This Love" M/V',                     channel_title: 'BLACKPINK',  duration: '3:13' },
  { video_id: 'dyRsYk0LyA8', title: 'BLACKPINK - "Lovesick Girls" M/V',                     channel_title: 'BLACKPINK',  duration: '3:15' },
  { video_id: 'kOHB85vDuow', title: 'TWICE "FANCY" M/V',                                    channel_title: 'JYP Entertainment', duration: '3:34' },
  { video_id: 'ePpPVE-GGJw', title: 'TWICE "TT" M/V',                                       channel_title: 'JYP Entertainment', duration: '3:34' },
  { video_id: '4TWR90KJl84', title: 'aespa 에스파 "Next Level" MV',                          channel_title: 'SMTOWN',     duration: '3:39' },
  { video_id: 'ZeerrnuLi5E', title: 'aespa 에스파 "Black Mamba" MV',                         channel_title: 'SMTOWN',     duration: '3:32' },
  { video_id: 'Y8JFxS1HlDo', title: 'IVE 아이브 "LOVE DIVE" MV',                             channel_title: 'STARSHIP ENTERTAINMENT', duration: '2:58' },
  { video_id: 'TaH4IXgXwVE', title: 'NewJeans (뉴진스) "Hype Boy" Official MV',              channel_title: 'HYBE LABELS', duration: '3:00' },
  { video_id: 'sVTy_wmn5SU', title: 'NewJeans (뉴진스) "OMG" Official MV',                   channel_title: 'HYBE LABELS', duration: '3:34' },
  { video_id: 'pSUydWEqKwE', title: 'NewJeans (뉴진스) "Ditto" Official MV',                 channel_title: 'HYBE LABELS', duration: '3:07' },
  { video_id: 'ZXbzYA3XEY8', title: '(G)I-DLE - "TOMBOY" Official Music Video',              channel_title: 'CUBE ENTERTAINMENT', duration: '2:53' },
  { video_id: '3iM_06QeZi8', title: 'LE SSERAFIM (르세라핌) FEARLESS MV',                    channel_title: 'HYBE LABELS', duration: '3:00' },
  { video_id: 'D1PvIWdJ8xo', title: '아이유 (IU) - Blueming',                                channel_title: '1theK (원더케이)', duration: '3:37' },
  { video_id: 'pBzsJwbWfRE', title: '아이유 (IU) - eight (Prod. & Feat. SUGA of BTS)',       channel_title: '1theK (원더케이)', duration: '2:47' },
  { video_id: '9bZkp7q19f0', title: 'PSY - GANGNAM STYLE(강남스타일) M/V',                   channel_title: 'officialpsy', duration: '4:13' },
  { video_id: 'qR_OuLhKdAY', title: 'Crush (크러쉬) - 아무노래 (Any song)',                   channel_title: 'Crush',      duration: '3:35' },
  { video_id: 'LQN6g7OoPHE', title: '10cm (십센치) - 그라데이션',                              channel_title: '10cm',       duration: '3:16' },
  { video_id: 'NyjWFofq5Is', title: 'Paul Kim (폴킴) - 모든 날, 모든 순간 (Every day, Every Moment)', channel_title: 'NEUE', duration: '4:13' },
  { video_id: 'rCxyiUptffY', title: '잔나비 JANNABI - 주저하는 연인들을 위해',                 channel_title: 'POCLANOS',   duration: '4:42' },
  { video_id: 'w4Ui6DdNxD0', title: 'AKMU (악뮤) - 어떻게 이별까지 사랑하겠어, 널 사랑하는 거지', channel_title: '1theK (원더케이)', duration: '4:42' },
];

function buildSongs() {
  return SEED_SONGS.map(s => ({
    ...s,
    thumbnail: `https://img.youtube.com/vi/${s.video_id}/mqdefault.jpg`,
  }));
}

async function main() {
  console.log('\n[1/2] 기존 데이터 삭제 중...');
  // CASCADE 로 votes/comments/replies(parent_id) 도 같이 삭제됨
  await db('song_comments').del();
  await db('comments').del();
  await db('votes').del();
  await db('daily_stats').del();
  await db('cafes').update({ now_playing_id: null });
  await db('recommendations').del();
  console.log('    완료');

  const songs = buildSongs();
  console.log(`\n[2/2] ${songs.length}곡으로 각 카페에 시드 중...`);
  const cafes = await db('cafes').select('id', 'name', 'slug');
  if (cafes.length === 0) {
    console.log('    등록된 카페가 없습니다.');
    process.exit(0);
  }

  const now = Date.now();
  for (const cafe of cafes) {
    // 각 카페마다 15곡을 최근 7일 사이 랜덤 시간대로 played 처리
    const picks = songs.sort(() => Math.random() - 0.5).slice(0, 15);
    const rows = picks.map((s, i) => {
      const daysAgo = Math.floor(Math.random() * 7);
      const hoursAgo = Math.floor(Math.random() * 24);
      const requested = new Date(now - daysAgo * 86400000 - hoursAgo * 3600000 - i * 60000);
      const played    = new Date(requested.getTime() + Math.floor(Math.random() * 600000));
      return {
        cafe_id:        cafe.id,
        video_id:       s.video_id,
        title:          s.title,
        channel_title:  s.channel_title,
        thumbnail:      s.thumbnail,
        duration:       s.duration,
        status:         'played',
        platform:       'youtube',
        requester_name: '손님',
        vote_count:     Math.floor(Math.random() * 5),
        requested_at:   requested,
        played_at:      played,
      };
    });
    await db('recommendations').insert(rows);
    console.log(`    [${cafe.name}] ${rows.length}곡 삽입`);
  }

  console.log('\n완료.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
