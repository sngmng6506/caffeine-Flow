import { describe, it, expect } from 'vitest';
import {
  PLATFORM,
  VALID_PLATFORMS,
  platformLabel,
  parseAllowedPlatforms,
  formatAllowedPlatforms,
} from '../src/constants/platforms.js';

describe('플랫폼 상수 계약', () => {
  it('지원 플랫폼 목록은 youtube/soundcloud/spotify다', () => {
    expect(VALID_PLATFORMS).toEqual([
      PLATFORM.YOUTUBE,
      PLATFORM.SOUNDCLOUD,
      PLATFORM.SPOTIFY,
    ]);
  });

  it('DB 문자열을 안전하게 허용 플랫폼 배열로 변환한다', () => {
    expect(parseAllowedPlatforms(null)).toEqual(VALID_PLATFORMS);
    expect(parseAllowedPlatforms('youtube,spotify')).toEqual([PLATFORM.YOUTUBE, PLATFORM.SPOTIFY]);
    expect(parseAllowedPlatforms('youtube,unknown,spotify')).toEqual([PLATFORM.YOUTUBE, PLATFORM.SPOTIFY]);
  });

  it('허용 플랫폼 배열을 DB 저장 문자열로 변환한다', () => {
    expect(formatAllowedPlatforms([PLATFORM.YOUTUBE, 'unknown', PLATFORM.SOUNDCLOUD])).toBe('youtube,soundcloud');
  });

  it('사용자 표시명은 한 곳에서 관리한다', () => {
    expect(platformLabel(PLATFORM.YOUTUBE)).toBe('YouTube');
    expect(platformLabel(PLATFORM.SOUNDCLOUD)).toBe('SoundCloud');
    expect(platformLabel(PLATFORM.SPOTIFY)).toBe('Spotify');
  });
});
