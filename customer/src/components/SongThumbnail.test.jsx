import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SongThumbnail from './SongThumbnail';

afterEach(cleanup);

function setNaturalSize(image, width, height) {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height });
}

describe('썸네일 대체 표시', () => {
  it('이미지가 없으면 음악 아이콘과 패턴을 표시한다', () => {
    const { container } = render(
      <SongThumbnail src='' className='thumb' fallbackClassName='thumb--fallback' />,
    );

    expect(container.querySelector('.song-thumbnail__fallback-icon')).not.toBeNull();
    expect(container.querySelector('.song-thumbnail__fallback-pattern')).not.toBeNull();
  });

  it('YouTube의 영상 없음 썸네일도 대체 표시로 바꾼다', () => {
    const { container } = render(
      <SongThumbnail
        src='https://img.youtube.com/vi/unavailable/mqdefault.jpg'
        className='thumb'
        fallbackClassName='thumb--fallback'
      />,
    );
    const image = container.querySelector('img');
    setNaturalSize(image, 120, 90);
    fireEvent.load(image);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.song-thumbnail__fallback-pattern')).not.toBeNull();
  });

  it('작은 비 YouTube 이미지는 정상 썸네일로 유지한다', () => {
    const { container } = render(
      <SongThumbnail
        src='https://images.example.com/cover.jpg'
        className='thumb'
        fallbackClassName='thumb--fallback'
      />,
    );
    const image = container.querySelector('img');
    setNaturalSize(image, 100, 100);
    fireEvent.load(image);

    expect(container.querySelector('img')).toBe(image);
  });

  it('로드에 실패하면 잠시 뒤 다시 받아 본다', async () => {
    // 네트워크가 한 번 흔들려 실패하면 그 곡은 화면에 남아 있는 동안 계속 대체
    // 표시였다. 손님이 화면을 새로 열어야 제대로 보이던 증상의 원인이다.
    vi.useFakeTimers();
    try {
      const { container } = render(
        <SongThumbnail src='https://i.ytimg.com/vi/abc/mqdefault.jpg' className='thumb' fallbackClassName='thumb--fallback' />,
      );

      fireEvent.error(container.querySelector('img'));
      expect(container.querySelector('img')).toBeNull();          // 재시도 중에도 대체 표시를 유지한다

      await act(async () => { await vi.advanceTimersByTimeAsync(500); });

      const retried = container.querySelector('img');
      expect(retried).not.toBeNull();
      // 브라우저가 실패를 캐시하므로 재시도에는 표식을 붙여 새로 받는다.
      expect(retried.getAttribute('src')).toContain('cf-retry=1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('재시도를 다 쓰면 대체 표시로 남는다', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <SongThumbnail src='https://i.ytimg.com/vi/abc/mqdefault.jpg' className='thumb' fallbackClassName='thumb--fallback' />,
      );

      for (const delay of [500, 1600]) {
        fireEvent.error(container.querySelector('img'));
        await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
      }
      fireEvent.error(container.querySelector('img'));
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('.song-thumbnail__fallback-pattern')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('연결이 돌아오면 다시 받아 본다', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <SongThumbnail src='https://i.ytimg.com/vi/abc/mqdefault.jpg' className='thumb' fallbackClassName='thumb--fallback' />,
      );

      // 재시도를 다 써서 대체 표시로 굳은 상태를 만든다.
      for (const delay of [500, 1600]) {
        fireEvent.error(container.querySelector('img'));
        await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
      }
      fireEvent.error(container.querySelector('img'));
      expect(container.querySelector('img')).toBeNull();

      await act(async () => { window.dispatchEvent(new Event('online')); });

      expect(container.querySelector('img')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
