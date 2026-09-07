import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRecentHistory } from '../../api';
import { trackKeyOf } from '../../trackKey';

export default function useCafeHistory({ slug, active }) {
  const [recommendations, setRecommendations] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setRecommendations([]);
    setHasMore(false);
    setLoaded(false);
    setError('');
  }, [slug]);

  useEffect(() => {
    if (!active || loaded) return;
    setLoading(true);
    setError('');
    getRecentHistory(slug, 0)
      .then(({ items, hasMore: nextHasMore }) => {
        setRecommendations(items);
        setHasMore(nextHasMore);
        setLoaded(true);
      })
      .catch(() => setError('잠시 후 다시 시도해 주세요.'))
      .finally(() => setLoading(false));
  }, [active, slug, loaded, retryKey]);

  const items = useMemo(() => [...recommendations]
    .sort((a, b) => new Date(b.played_at || b.requested_at) - new Date(a.played_at || a.requested_at)), [recommendations]);

  const loadMore = useCallback(async () => {
    setLoading(true);
    try {
      const page = await getRecentHistory(slug, recommendations.length);
      setRecommendations(previous => [
        ...previous,
        ...page.items.filter(item => !previous.some(existing => existing.id === item.id)),
      ]);
      setHasMore(page.hasMore);
    } catch {
      // 기존 이력은 유지하고 다시 시도할 수 있게 둔다.
    } finally {
      setLoading(false);
    }
  }, [slug, recommendations.length]);

  const retry = useCallback(() => setRetryKey(value => value + 1), []);

  const upsertRecommendation = useCallback((recommendation) => {
    setRecommendations(previous => previous.some(item => item.id === recommendation.id)
      ? previous.map(item => item.id === recommendation.id ? recommendation : item)
      : [recommendation, ...previous]);
  }, []);

  const updateRecommendation = useCallback((recommendation) => {
    setRecommendations(previous => previous.map(item => item.id === recommendation.id ? recommendation : item));
  }, []);

  const patchSongVote = useCallback((trackKey, voteCount) => {
    if (!trackKey) return;
    setRecommendations(previous => previous.map(item => (trackKeyOf(item.video_id) === trackKey
      ? { ...item, vote_count: voteCount }
      : item)));
  }, []);

  return {
    items,
    hasMore,
    loading,
    error,
    loadMore,
    retry,
    upsertRecommendation,
    updateRecommendation,
    patchSongVote,
  };
}
