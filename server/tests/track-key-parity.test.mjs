// 곡 키 규칙이 서버·SQL·손님 화면에서 같은지 검사.
//
// "같은 곡"의 정의(곡 참조의 '?' 앞부분)가 세 곳에 따로 있다.
// - 서버 trackKeyOf: 신청·댓글·재생 이력을 저장할 때, 분석을 찾을 때
// - SQL TRACK_KEY_SQL: 좋아요 수와 TOP 집계에서 곡을 묶을 때
// - 손님 화면 trackKeyOf: 좋아요 눌림 표시를 곡 단위로 기억할 때
// 한쪽만 바뀌면 손님 화면에는 좋아요가 눌린 것으로 보이는데 서버는 다른 곡으로
// 센다. 손님 화면은 별도 빌드라 코드를 공유하지 않으므로 결과로 맞춰 본다.
import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { trackKeyOf as customerTrackKeyOf } from '../../customer/src/trackKey.js';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);
const db = require('../src/db/knex');
const { trackKeyOf } = require('../src/utils/track-key');
const { TRACK_KEY_SQL } = require('../src/db/sql-fragments');

// 세 곳에 똑같이 넣어 볼 입력.
// - 플랫폼별 곡 참조 모양(YouTube 영상 ID, SoundCloud·Spotify URL)과, 같은 곡에
//   추적 파라미터가 붙은 변형. 둘이 같은 곡 키가 되는지가 핵심이다.
// - 규칙이 갈라지기 쉬운 경계값: '?'가 두 번(첫 '?'에서 자르는지), '?'로 시작,
//   빈 문자열. 운영에 들어오는 값은 아니지만 구현마다 처리가 달라지기 쉬운 곳이다.
const REFS = [
  'dQw4w9WgXcQ',
  'dQw4w9WgXcQ?t=42',
  'https://soundcloud.com/forss/flickermood',
  'https://soundcloud.com/forss/flickermood?utm_source=clipboard',
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc123',
  'abc?a=1?b=2',
  '?only-query',
  '',
];

async function sqlTrackKey(ref) {
  const { rows } = await db.raw(`SELECT ${TRACK_KEY_SQL} AS key FROM (VALUES (?::text)) AS t(video_id)`, [ref]);
  return rows[0].key;
}

afterAll(() => db.destroy());

describe('곡 키 규칙', () => {
  it.each(REFS)('%j를 세 곳이 같은 곡 키로 만든다', async (ref) => {
    const server = trackKeyOf(ref);
    expect(customerTrackKeyOf(ref)).toBe(server);
    expect(await sqlTrackKey(ref)).toBe(server);
  });

  it('추적 파라미터만 다른 참조는 같은 곡이다', () => {
    expect(trackKeyOf('https://open.spotify.com/track/x?si=1')).toBe(trackKeyOf('https://open.spotify.com/track/x?si=2'));
  });
});
