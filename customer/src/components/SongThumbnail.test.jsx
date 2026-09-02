import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
});
