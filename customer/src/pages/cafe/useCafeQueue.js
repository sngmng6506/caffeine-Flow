import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRecommendations } from '../../api';
import { getSocket, disconnectSocket } from '../../socket';
import { trackKeyOf } from '../../trackKey';
import { VALID_PLATFORMS } from '../../constants/platforms';
import { ACTIVE_STATUSES, HISTORY_STATUSES, REC_STATUS } from '../../constants/recommendationStatus';
import { PLAYBACK_STATE } from '../../constants/playbackState';

const UNKNOWN_PLAYBACK = {
  state: PLAYBACK_STATE.UNKNOWN,
  recommendationId: null,
  track: null,
};

export default function useCafeQueue({
  slug,
  onHistoryTransition,
  onHistoryUpdate,
  onSongVote,
}) {
  const [recommendations, setRecommendations] = useState([]);
  const [isAccepting, setIsAccepting] = useState(true);
  const [notice, setNotice] = useState(null);
  const [cafeName, setCafeName] = useState('');
  const [allowedPlatforms, setAllowedPlatforms] = useState(VALID_PLATFORMS);
  const [playbackState, setPlaybackState] = useState(UNKNOWN_PLAYBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const applySnapshot = useCallback((snapshot) => {
    setRecommendations(snapshot.recommendations);
    setIsAccepting(snapshot.is_accepting);
    setNotice(snapshot.notice);
    setCafeName(snapshot.cafe_name);
    if (snapshot.allowed_platforms) setAllowedPlatforms(snapshot.allowed_platforms);
  }, []);

  const patchSongVote = useCallback((trackKey, voteCount) => {
    if (!trackKey) return;
    setRecommendations(previous => previous.map(item => (trackKeyOf(item.video_id) === trackKey
      ? { ...item, vote_count: voteCount }
      : item)));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    getRecommendations(slug)
      .then(applySnapshot)
      .catch(caught => setError(caught.message))
      .finally(() => setLoading(false));

    const socket = getSocket(slug);
    let connected = false;

    socket.on('connect', () => {
      if (!connected) {
        connected = true;
        return;
      }
      getRecommendations(slug).then(applySnapshot).catch(() => {});
    });

    socket.on('recommendations_update', ({ action, rec, id }) => {
      if (action === 'add') {
        setRecommendations(previous => previous.some(item => item.id === rec.id) ? previous : [rec, ...previous]);
      }
      if (action === 'update' || action === 'vote') {
        if (HISTORY_STATUSES.includes(rec.status)) {
          setRecommendations(previous => previous.filter(item => item.id !== rec.id));
          onHistoryTransition(rec);
        } else {
          setRecommendations(previous => previous.map(item => item.id === rec.id
            ? { ...rec, is_mine: item.is_mine }
            : item));
        }
      }
      if (action === 'delete') setRecommendations(previous => previous.filter(item => item.id !== id));
    });

    socket.on('song_vote', ({ track_key, vote_count }) => {
      patchSongVote(track_key, vote_count);
      onSongVote(track_key, vote_count);
    });
    socket.on('system_toggled', ({ is_accepting }) => setIsAccepting(is_accepting));
    socket.on('notice_updated', ({ notice: nextNotice }) => setNotice(nextNotice));
    socket.on('cafe_updated', ({ cafe_name }) => setCafeName(cafe_name));
    socket.on('platforms_updated', ({ allowed_platforms }) => setAllowedPlatforms(allowed_platforms));
    socket.on('playback_state', payload => {
      if (!Object.values(PLAYBACK_STATE).includes(payload?.state)) return;
      setPlaybackState({
        state: payload.state,
        recommendationId: payload.recommendationId || null,
        track: payload.track || null,
      });
    });
    socket.on('cafe_moved', ({ movedTo }) => {
      if (movedTo) window.location.replace(`/${movedTo}`);
    });

    return () => disconnectSocket();
  }, [slug, applySnapshot, patchSongVote, onHistoryTransition, onSongVote]);

  const updateRecommendation = useCallback((recommendation) => {
    if (HISTORY_STATUSES.includes(recommendation.status)) {
      onHistoryUpdate(recommendation);
      return;
    }
    setRecommendations(previous => previous.map(item => item.id === recommendation.id ? recommendation : item));
  }, [onHistoryUpdate]);

  const addRecommendation = useCallback((recommendation) => {
    setRecommendations(previous => previous.some(item => item.id === recommendation.id)
      ? previous.map(item => item.id === recommendation.id ? recommendation : item)
      : [recommendation, ...previous]);
  }, []);

  const removeRecommendation = useCallback((id) => {
    setRecommendations(previous => previous.filter(item => item.id !== id));
  }, []);

  const nowPlaying = useMemo(() => recommendations.find(item => item.status === REC_STATUS.PLAYING) || null, [recommendations]);
  const waitingQueue = useMemo(() => recommendations
    .filter(item => item.status === REC_STATUS.ACCEPTED)
    .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at)), [recommendations]);
  const pendingQueue = useMemo(() => recommendations
    .filter(item => item.status === REC_STATUS.PENDING)
    .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at)), [recommendations]);
  const activeVideoIds = useMemo(() => recommendations
    .filter(item => ACTIVE_STATUSES.includes(item.status))
    .map(item => item.video_id), [recommendations]);

  return {
    recommendations,
    isAccepting,
    notice,
    cafeName,
    allowedPlatforms,
    playbackState,
    loading,
    error,
    nowPlaying,
    waitingQueue,
    pendingQueue,
    activeVideoIds,
    addRecommendation,
    updateRecommendation,
    removeRecommendation,
    patchSongVote,
  };
}
