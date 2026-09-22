// 데모 곡이 실재하는 트랙 모양인지 검사.
//
// 데모에 'played-twice' 같은 가짜 video_id가 들어 있던 적이 있다. 손님 화면에서는
// 멀쩡해 보이는데, 곡 링크를 복사해 다시 신청하면 형식만 맞는 YouTube 주소가
// 만들어져 "영상 정보를 가져올 수 없습니다"로 막혔다. 눈으로는 안 보이는 결함이라
// 테스트가 잡아야 한다.
//
// 고정하는 것은 운영에서의 video_id 모양이다 — YouTube는 11자 영상 ID,
// SoundCloud·Spotify는 전체 URL(track-metadata.service의 videoId: trackUrl).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mainCafeRows, otherCafeRows } = require('../scripts/seed-demo');
const { detectPlatform } = require('../src/services/track-metadata.service');
const { PLATFORM } = require('../src/constants/platforms');

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const rows = [...mainCafeRows('demo-cafe-id'), ...otherCafeRows('other-cafe-id')];

describe('데모 시드 곡', () => {
  it('곡이 비어 있지 않다', () => {
    expect(rows.length).toBeGreaterThan(5);
  });

  it('YouTube 곡은 11자 영상 ID다', () => {
    const youtube = rows.filter(row => row.platform === PLATFORM.YOUTUBE);
    expect(youtube.length).toBeGreaterThan(0);
    for (const row of youtube) {
      expect(row.video_id, `${row.title}의 video_id`).toMatch(YOUTUBE_ID);
    }
  });

  it('SoundCloud·Spotify 곡은 그 플랫폼의 전체 URL이다', () => {
    const urlPlatforms = rows.filter(row => row.platform !== PLATFORM.YOUTUBE);
    expect(urlPlatforms.length).toBeGreaterThan(0);
    for (const row of urlPlatforms) {
      // 서버가 손님 입력을 판정할 때 쓰는 함수로 그대로 확인한다.
      expect(detectPlatform(row.video_id), `${row.title}의 video_id`).toBe(row.platform);
    }
  });

  it('썸네일은 저장된 플랫폼 주소이거나 비어 있다', () => {
    for (const row of rows) {
      if (!row.thumbnail) continue;
      expect(() => new URL(row.thumbnail), `${row.title}의 thumbnail`).not.toThrow();
    }
  });
});
