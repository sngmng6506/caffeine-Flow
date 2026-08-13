import { describe, expect, it } from 'vitest';
import {
  defaultToRecommendationPayload,
  metadataToDefault,
  recommendationToDefault,
} from '../../owner/src/pages/dashboard/musicResource.mjs';

describe('owner default BGM drag metadata', () => {
  it('Spotify 기본 BGM을 큐로 옮겨도 플랫폼과 메타데이터를 보존한다', () => {
    const info = metadataToDefault({
      videoId: 'https://open.spotify.com/track/abc',
      title: 'Song',
      channelTitle: 'Artist',
      thumbnail: 'https://image.test/song.jpg',
      platform: 'spotify',
    }, 'https://open.spotify.com/track/abc');

    expect(defaultToRecommendationPayload(info)).toMatchObject({
      videoId: 'https://open.spotify.com/track/abc',
      platform: 'spotify',
      channelTitle: 'Artist',
    });
  });

  it('추천곡을 기본 BGM으로 옮길 때 플랫폼을 보존한다', () => {
    expect(recommendationToDefault({
      video_id: 'https://soundcloud.com/artist/song',
      title: 'SC Song',
      channel_title: 'Artist',
      platform: 'soundcloud',
    })).toMatchObject({
      url: 'https://soundcloud.com/artist/song',
      platform: 'soundcloud',
      channelTitle: 'Artist',
    });
  });
});
