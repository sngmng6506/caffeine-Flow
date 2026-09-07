import { useCallback, useEffect, useState } from 'react';
import {
  getCafeTop10,
  getGlobalTop10,
  voteSong,
  unvoteSong,
} from '../../api';
import { markVoted, removeVote } from '../../votedSongs';
import { trackKeyOf } from '../../trackKey';

const TOP_TABS = ['cafeTop', 'globalTop'];

function patchTopVote(items, trackKey, voteCount) {
  return items.map(item => (trackKeyOf(item.video_id) === trackKey
    ? { ...item, total_votes: voteCount }
    : item));
}

export default function useTopSongs({ slug, tab }) {
  const [cafeItems, setCafeItems] = useState([]);
  const [cafeHasMore, setCafeHasMore] = useState(false);
  const [globalItems, setGlobalItems] = useState([]);
  const [globalHasMore, setGlobalHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState({ cafeTop: false, globalTop: false });
  const [sort, setSort] = useState({ cafeTop: 'count', globalTop: 'count' });
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setCafeItems([]);
    setCafeHasMore(false);
    setGlobalItems([]);
    setGlobalHasMore(false);
    setLoaded({ cafeTop: false, globalTop: false });
    setError('');
  }, [slug]);

  const cafeLoaded = loaded.cafeTop;
  const globalLoaded = loaded.globalTop;
  const cafeSort = sort.cafeTop;
  const globalSort = sort.globalTop;

  useEffect(() => {
    const load = (fetchTop, apply, key) => {
      setLoading(true);
      setError('');
      fetchTop()
        .then(({ items, hasMore }) => {
          apply(items, hasMore);
          setLoaded(previous => ({ ...previous, [key]: true }));
        })
        .catch(() => setError('잠시 후 다시 시도해 주세요.'))
        .finally(() => setLoading(false));
    };

    if (tab === 'cafeTop' && !cafeLoaded) {
      load(
        () => getCafeTop10(slug, 0, cafeSort),
        (items, hasMore) => { setCafeItems(items); setCafeHasMore(hasMore); },
        'cafeTop',
      );
      return;
    }

    if (tab === 'globalTop' && !globalLoaded) {
      load(
        () => getGlobalTop10(0, globalSort),
        (items, hasMore) => { setGlobalItems(items); setGlobalHasMore(hasMore); },
        'globalTop',
      );
      return;
    }

    if ((tab === 'cafeTop' && cafeLoaded) || (tab === 'globalTop' && globalLoaded)) {
      setError('');
    }
  }, [tab, slug, cafeLoaded, globalLoaded, cafeSort, globalSort, retryKey]);

  const loadMore = useCallback(async () => {
    if (!TOP_TABS.includes(tab)) return;
    setLoading(true);
    try {
      if (tab === 'cafeTop') {
        const page = await getCafeTop10(slug, cafeItems.length, cafeSort);
        setCafeItems(previous => [...previous, ...page.items]);
        setCafeHasMore(page.hasMore);
      } else {
        const page = await getGlobalTop10(globalItems.length, globalSort);
        setGlobalItems(previous => [...previous, ...page.items]);
        setGlobalHasMore(page.hasMore);
      }
    } catch {
      // 기존 목록은 유지하고 다시 시도할 수 있게 둔다.
    } finally {
      setLoading(false);
    }
  }, [tab, slug, cafeItems.length, cafeSort, globalItems.length, globalSort]);

  const changeSort = useCallback(async (nextSort) => {
    if (!TOP_TABS.includes(tab) || !['count', 'votes'].includes(nextSort) || nextSort === sort[tab]) return;
    const previousSort = sort[tab];
    setSort(previous => ({ ...previous, [tab]: nextSort }));
    setLoading(true);
    try {
      const result = tab === 'cafeTop'
        ? await getCafeTop10(slug, 0, nextSort)
        : await getGlobalTop10(0, nextSort);
      if (tab === 'cafeTop') {
        setCafeItems(result.items);
        setCafeHasMore(result.hasMore);
      } else {
        setGlobalItems(result.items);
        setGlobalHasMore(result.hasMore);
      }
    } catch {
      setSort(previous => ({ ...previous, [tab]: previousSort }));
    } finally {
      setLoading(false);
    }
  }, [tab, slug, sort]);

  const patchSongVote = useCallback((trackKey, voteCount) => {
    if (!trackKey) return;
    setCafeItems(previous => patchTopVote(previous, trackKey, voteCount));
    setGlobalItems(previous => patchTopVote(previous, trackKey, voteCount));
  }, []);

  const toggleVote = useCallback(async (trackKey, voted) => {
    const { vote_count: voteCount } = voted
      ? await unvoteSong(slug, trackKey)
      : await voteSong(slug, trackKey);
    if (voted) removeVote(slug, trackKey);
    else markVoted(slug, trackKey);
    patchSongVote(trackKey, voteCount);
    return voteCount;
  }, [slug, patchSongVote]);

  const retry = useCallback(() => setRetryKey(value => value + 1), []);

  return {
    items: tab === 'cafeTop' ? cafeItems : globalItems,
    hasMore: tab === 'cafeTop' ? cafeHasMore : globalHasMore,
    loading,
    error,
    sortBy: sort[tab] || 'count',
    retry,
    loadMore,
    changeSort,
    patchSongVote,
    toggleVote,
  };
}
