import { describe, expect, it } from 'vitest';
import payloadModule from '../src/socket/playback-payload.js';

const { sanitizePlaybackTrack } = payloadModule;

describe('public playback track payload', () => {
  it('공개 가능한 필드만 길이를 제한해 반환한다', () => {
    expect(sanitizePlaybackTrack({
      title: '곡 제목',
      artist: '아티스트',
      thumbnail: 'https://i.scdn.co/image/example',
      platform: 'spotify',
      token: 'secret',
    })).toEqual({
      title: '곡 제목',
      artist: '아티스트',
      thumbnail: 'https://i.scdn.co/image/example',
      platform: 'spotify',
    });
  });

  it('미지원 플랫폼과 외부 추적 이미지를 차단한다', () => {
    expect(sanitizePlaybackTrack({ title: '곡', platform: 'other' })).toBeNull();
    expect(sanitizePlaybackTrack({
      title: '곡',
      platform: 'youtube',
      thumbnail: 'https://tracker.example/pixel.png',
    })).toMatchObject({ thumbnail: null });
  });
});
