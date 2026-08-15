import { describe, expect, it } from 'vitest';
import currentTrackModule from '../../owner/electron/platform-adapters/current-track.js';

const { READ_CURRENT_TRACK, normalizeTrack } = currentTrackModule;

describe('Electron current track metadata', () => {
  it('BrowserView에서 실행할 감지 스크립트가 유효한 JavaScript다', () => {
    expect(() => new Function(`return ${READ_CURRENT_TRACK}`)).not.toThrow();
    expect(READ_CURRENT_TRACK).toContain('/\\s+-\\s+YouTube');
  });

  it('지원 플랫폼의 현재 곡 정보만 정규화한다', () => {
    expect(normalizeTrack({
      title: '  곡 제목  ',
      artist: '  아티스트 ',
      thumbnail: ' https://i.ytimg.com/example.jpg ',
      platform: 'youtube',
    })).toEqual({
      title: '곡 제목',
      artist: '아티스트',
      thumbnail: 'https://i.ytimg.com/example.jpg',
      platform: 'youtube',
    });
  });

  it('플랫폼 곡 ID와 종료 진행률을 함께 정규화한다', () => {
    expect(normalizeTrack({
      title: '곡 제목',
      platform: 'spotify',
      videoId: 'https://open.spotify.com/track/example',
      mediaDuration: 180,
      mediaCurrentTime: 179,
      mediaEnded: true,
    })).toMatchObject({
      videoId: 'https://open.spotify.com/track/example',
      mediaDuration: 180,
      mediaCurrentTime: 179,
      mediaEnded: true,
    });
  });

  it('플랫폼 홈 화면 제목과 미지원 플랫폼을 곡으로 취급하지 않는다', () => {
    expect(normalizeTrack({ title: 'YouTube', platform: 'youtube' })).toBeNull();
    expect(normalizeTrack({ title: '곡 제목', platform: 'other' })).toBeNull();
  });
});
