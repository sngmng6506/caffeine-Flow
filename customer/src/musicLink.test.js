// 곡 링크 생성과 복사.
//
// 손님이 곡을 길게 눌러 링크를 복사하는 경로다. video_id에는 YouTube 영상 ID가
// 올 수도, SoundCloud/Spotify의 전체 URL이 올 수도 있어(플랫폼별로 서버가
// 저장하는 값이 다르다) 두 형태를 모두 같은 함수가 처리한다. 여기서 형태를
// 잘못 판정하면 손님에게 열리지 않는 링크가 복사된다.
//
// 계약: docs/AI_CHANGE_GUARDRAILS.md#platform-contract
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { musicLinkFromVideoId, copyMusicLink } from './musicLink';

describe('musicLinkFromVideoId', () => {
  it('YouTube 영상 ID는 watch URL로 만든다', () => {
    expect(musicLinkFromVideoId('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('http(s) URL은 그대로 쓴다', () => {
    const url = 'https://soundcloud.com/artist/track';
    expect(musicLinkFromVideoId(url)).toBe(url);
  });

  it('URL 형태여도 http(s)가 아니면 영상 ID로 취급한다', () => {
    // javascript:, data: 같은 스킴이 링크로 새어 나가지 않게 한다.
    expect(musicLinkFromVideoId('javascript:alert(1)')).toContain('youtube.com/watch?v=');
  });

  it('영상 ID를 URL 인코딩해 쿼리를 깨지 않는다', () => {
    expect(musicLinkFromVideoId('a&b=c')).toBe('https://www.youtube.com/watch?v=a%26b%3Dc');
  });

  it('빈 값과 공백은 빈 문자열이다', () => {
    expect(musicLinkFromVideoId('')).toBe('');
    expect(musicLinkFromVideoId('   ')).toBe('');
    expect(musicLinkFromVideoId(null)).toBe('');
    expect(musicLinkFromVideoId(undefined)).toBe('');
  });
});

describe('copyMusicLink', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('링크를 만들 수 없으면 복사를 시도하지 않는다', async () => {
    await expect(copyMusicLink('')).rejects.toThrow('missing_music_link');
  });

  it('execCommand가 성공하면 Clipboard API를 쓰지 않는다', async () => {
    // 모바일에서는 pointerup 제스처가 살아 있는 동안 동기식으로 복사해야 한다.
    // 비동기 Clipboard API를 먼저 기다리면 권한이 만료된다.
    document.execCommand = vi.fn(() => true);
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    await expect(copyMusicLink('vid')).resolves.toContain('vid');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(writeText).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('execCommand를 못 쓰면 Clipboard API로 넘어간다', async () => {
    document.execCommand = vi.fn(() => false);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    await copyMusicLink('vid');
    expect(writeText).toHaveBeenCalledWith('https://www.youtube.com/watch?v=vid');
    vi.unstubAllGlobals();
  });

  it('두 경로가 모두 없으면 실패를 알린다', async () => {
    document.execCommand = vi.fn(() => false);
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });

    await expect(copyMusicLink('vid')).rejects.toThrow('copy_failed');
    vi.unstubAllGlobals();
  });

  it('복사가 막히면 손님이 직접 복사할 링크를 함께 넘긴다', async () => {
    // iOS 인앱 WebView처럼 두 경로가 모두 막히는 환경이 있다. 거기서는 다시 눌러도
    // 같은 결과라, 화면이 링크를 보여줄 수 있어야 한다.
    document.execCommand = vi.fn(() => false);
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });

    await expect(copyMusicLink('vid')).rejects.toMatchObject({
      message: 'copy_failed',
      link: 'https://www.youtube.com/watch?v=vid',
    });
    vi.unstubAllGlobals();
  });

  it('Clipboard API가 권한으로 거부돼도 링크를 넘긴다', async () => {
    // 쓰기 권한이 자동 허용되지 않는 환경에서 writeText는 NotAllowedError로 거부된다.
    document.execCommand = vi.fn(() => false);
    const writeText = vi.fn(async () => { throw new Error('NotAllowedError'); });
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    await expect(copyMusicLink('vid')).rejects.toMatchObject({
      link: 'https://www.youtube.com/watch?v=vid',
    });
    expect(writeText).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('복사 후 임시 textarea를 남기지 않는다', async () => {
    document.execCommand = vi.fn(() => true);
    await copyMusicLink('vid');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('iOS에서 선택이 잡히도록 readOnly를 쓰지 않고 Selection까지 건다', async () => {
    // iOS Safari는 readOnly 입력에서 선택 범위를 만들지 못해 execCommand가 false를 낸다.
    // 그러면 Clipboard API로 넘어가는데 그쪽은 쓰기 권한이 없으면 거부돼 복사가 통째로
    // 실패한다. 1차 시도의 조건을 여기서 고정한다.
    const seen = {};
    document.execCommand = vi.fn(() => {
      const textarea = document.querySelector('textarea');
      seen.readOnly = textarea.readOnly;
      seen.contentEditable = textarea.contentEditable;
      seen.rangeCount = window.getSelection().rangeCount;
      return true;
    });

    await copyMusicLink('vid');

    expect(seen.readOnly).toBe(false);
    expect(seen.contentEditable).toBe('true');
    expect(seen.rangeCount).toBeGreaterThan(0);
  });

  it('복사한 뒤 화면에 보이는 선택을 남기지 않는다', async () => {
    // 선택이 남으면 iOS에서 곡 제목에 하이라이트가 보인다. 실제 브라우저는 포커스를
    // 되돌린 자리에 빈 캐럿(collapsed range)을 남기므로 rangeCount가 아니라
    // 선택된 문자열이 비었는지로 고정한다.
    document.execCommand = vi.fn(() => true);
    await copyMusicLink('vid');
    expect(window.getSelection().toString()).toBe('');
  });
});
