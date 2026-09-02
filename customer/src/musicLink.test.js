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

  it('복사 후 임시 textarea를 남기지 않는다', async () => {
    document.execCommand = vi.fn(() => true);
    await copyMusicLink('vid');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});
