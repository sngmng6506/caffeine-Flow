import { describe, expect, it } from 'vitest';
import { clearOwnerSession, parseInitialState } from '../../owner/src/utils/initialSession.mjs';

function dependencies({ hash = '', search = '', stored = {} } = {}) {
  const values = new Map(Object.entries(stored));
  const replacements = [];
  return {
    input: {
      location: { hash, search, pathname: '/owner/' },
      history: { replaceState: (...args) => replacements.push(args) },
      storage: {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
      },
    },
    values,
    replacements,
  };
}

describe('owner 초기 세션 복구', () => {
  it('로그아웃할 때 인증 정보만 지우고 기기 설정은 유지한다', () => {
    const deps = dependencies({
      stored: {
        token: 'saved-token',
        cafe: JSON.stringify({ id: 'cafe-id', slug: 'cafe-slug' }),
        'cf_default_video:cafe-id': JSON.stringify({ videoId: 'video-id' }),
        cf_panel_ratio: '0.42',
      },
    });

    clearOwnerSession(deps.input.storage);

    expect(deps.values.has('token')).toBe(false);
    expect(deps.values.has('cafe')).toBe(false);
    expect(deps.values.has('cf_default_video:cafe-id')).toBe(true);
    expect(deps.values.get('cf_panel_ratio')).toBe('0.42');
  });

  it('percent 문자가 있는 정상 OAuth cafe JSON을 한 번만 decode한다', () => {
    const cafe = { id: 'cafe-id', slug: 'percentcafe', name: '100% 카페' };
    const deps = dependencies({
      hash: `#token=session-token&cafe=${encodeURIComponent(JSON.stringify(cafe))}`,
    });
    const result = parseInitialState(deps.input);
    expect(result).toEqual({ cafe, pending: null, oauthError: '' });
    expect(deps.values.get('token')).toBe('session-token');
    expect(deps.replacements).toHaveLength(1);
  });

  it('불완전하거나 손상된 callback은 URL과 저장 세션을 정리한다', () => {
    const deps = dependencies({ hash: '#token=only-token', stored: { token: 'old', cafe: '{bad' } });
    const result = parseInitialState(deps.input);
    expect(result.cafe).toBeNull();
    expect(result.oauthError).toContain('로그인 정보');
    expect(deps.values.has('token')).toBe(false);
    expect(deps.values.has('cafe')).toBe(false);
    expect(deps.replacements).toHaveLength(1);
  });

  it('손상된 localStorage JSON은 앱을 중단하지 않고 로그아웃 상태로 복구한다', () => {
    const deps = dependencies({ stored: { token: 'saved-token', cafe: '{not-json' } });
    const result = parseInitialState(deps.input);
    expect(result.cafe).toBeNull();
    expect(result.oauthError).toContain('손상');
    expect(deps.values.size).toBe(0);
  });
});
