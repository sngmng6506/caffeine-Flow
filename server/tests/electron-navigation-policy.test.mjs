import { describe, it, expect } from 'vitest';
import policy from '../../owner/electron/navigation-policy.js';
import webPreferences from '../../owner/electron/web-preferences.js';

const {
  isAllowedMusicUrl,
  isAllowedLoginUrl,
  isAllowedQrImageUrl,
  isAllowedOwnerRendererUrl,
  toRecommendationUrl,
} = policy;
const { ISOLATED_EXTERNAL_WEB_PREFERENCES, STEALTH_EXTERNAL_WEB_PREFERENCES } = webPreferences;

describe('Electron 외부 URL 경계', () => {
  it('지원 음악 플랫폼의 HTTPS URL만 허용한다', () => {
    expect(isAllowedMusicUrl('https://music.youtube.com/watch?v=abc')).toBe(true);
    expect(isAllowedMusicUrl('https://open.spotify.com/track/abc')).toBe(true);
    expect(isAllowedMusicUrl('https://soundcloud.com/a/b')).toBe(true);
    expect(isAllowedMusicUrl('https://evil.example/')).toBe(false);
    expect(isAllowedMusicUrl('http://youtube.com/watch?v=abc')).toBe(false);
  });

  it('로그인 창은 지정된 계정 origin만 허용한다', () => {
    expect(isAllowedLoginUrl('https://accounts.google.com/ServiceLogin')).toBe(true);
    expect(isAllowedLoginUrl('https://accounts.spotify.com/ko/login')).toBe(true);
    expect(isAllowedLoginUrl('https://spotify.com.example.com/login')).toBe(false);
  });

  it('QR 다운로드는 고정된 이미지 생성 경로만 허용한다', () => {
    expect(isAllowedQrImageUrl('https://api.qrserver.com/v1/create-qr-code/?data=test&size=600x600&margin=20&format=jpg')).toBe(true);
    expect(isAllowedQrImageUrl('https://api.qrserver.com/v1/create-qr-code/?data=test&size=4000x4000&margin=20&format=jpg')).toBe(false);
    expect(isAllowedQrImageUrl('https://api.qrserver.com/other')).toBe(false);
    expect(isAllowedQrImageUrl('https://api.qrserver.com.evil.test/v1/create-qr-code/')).toBe(false);
  });

  it('IPC renderer는 설정된 owner origin과 정확히 일치해야 한다', () => {
    const ownerUrl = 'https://owner.example/owner/';
    expect(isAllowedOwnerRendererUrl('https://owner.example/owner/dashboard', ownerUrl)).toBe(true);
    expect(isAllowedOwnerRendererUrl('https://accounts.google.com/login', ownerUrl)).toBe(false);
    expect(isAllowedOwnerRendererUrl('https://owner.example.evil.test/', ownerUrl)).toBe(false);
  });

  it('신청곡은 YouTube ID 또는 허용 플랫폼 URL만 재생 URL로 바꾼다', () => {
    expect(toRecommendationUrl('abc_DEF-123')).toBe('https://www.youtube.com/watch?v=abc_DEF-123');
    expect(toRecommendationUrl('https://evil.example/track')).toBeNull();
  });

  it('외부 WebContents는 Node를 끄고 sandbox를 사용한다', () => {
    expect(ISOLATED_EXTERNAL_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    expect(STEALTH_EXTERNAL_WEB_PREFERENCES).toEqual({
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: true,
    });
  });
});
