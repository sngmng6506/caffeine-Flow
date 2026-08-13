import { useEffect, useRef, useState } from 'react';
import { getRecommendations, updateRec, setStatus, getMe, updateMusicFilter } from '../../api';
import { getSocket, disconnectSocket } from '../../socket';
import { parseAllowedPlatforms } from '../../constants/platforms';
import { REC_STATUS } from '../../constants/recommendationStatus';
import { PLAYBACK_STATE } from '../../constants/playbackState';
import { readSavedBgm, savedToBgmUrl } from './bgmStorage';
import { byPriority, isAutoAcceptEligible } from './queuePolicy';
import { requestElectronPlayback } from './playbackBridge.mjs';

export default function useRecommendationQueue({
  cafe,
  setCafe,
  setAllowedPlatforms,
  setCustomerUrl,
  onPromptRequired,
}) {
  const [recommendations, setRecommendations] = useState([]);
  const recommendationsRef = useRef([]);
  const [isAccepting, setIsAccepting] = useState(true);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [loading, setLoading] = useState(true);
  const [widevineStatus, setWidevineStatus] = useState(null);
  const [aiAutoAccept, setAiAutoAccept] = useState(false);
  const [isPlaybackLeader, setIsPlaybackLeader] = useState(false);
  const aiAutoAcceptRef = useRef(aiAutoAccept);
  const playbackLeaderRef = useRef(false);
  const playingTransitionRef = useRef(false);
  const playbackAvailable = typeof window.electronAPI?.playRec === 'function';

  recommendationsRef.current = recommendations;
  aiAutoAcceptRef.current = aiAutoAccept;
  playbackLeaderRef.current = isPlaybackLeader;

  function storeRecommendation(updated) {
    recommendationsRef.current = recommendationsRef.current.map(rec =>
      rec.id === updated.id ? updated : rec
    );
    setRecommendations(previous => previous.map(rec =>
      rec.id === updated.id ? updated : rec
    ));
  }

  // 소켓 add 이벤트와 수동 수락이 겹쳐도 renderer에서는 한 번에 한 곡만
  // playing 전환을 요청한다. 서버도 카페 잠금으로 최종 불변식을 보장한다.
  async function startPlaying(rec) {
    if (!playbackAvailable || !playbackLeaderRef.current) return null;
    if (playingTransitionRef.current) return null;
    if (recommendationsRef.current.some(item => item.status === REC_STATUS.PLAYING)) return null;

    playingTransitionRef.current = true;
    try {
      // Electron이 URL 검증과 화면 navigation을 받아들인 뒤에만 DB를
      // playing으로 바꾼다. 서버 갱신 실패 시 실제 플레이어도 즉시 복구한다.
      const result = await requestElectronPlayback(window.electronAPI, rec.video_id);
      if (!result?.ok) throw new Error(result?.error || '신청곡 재생을 시작하지 못했습니다.');
      try {
        const playing = await updateRec(cafe.slug, rec.id, REC_STATUS.PLAYING);
        storeRecommendation(playing);
        return playing;
      } catch (error) {
        window.electronAPI.endRec();
        throw error;
      }
    } finally {
      playingTransitionRef.current = false;
    }
  }

  // 다음 곡 재생 또는 정지.
  // 1) accepted 1순위 재생
  // 2) AI 자동수락 ON이면 필터 통과 pending 1순위를 승격해 재생
  // 3) 모두 없으면 BGM으로 복귀
  async function playNextOrStop(snapshot) {
    const nextAccepted = snapshot.filter(rec => rec.status === REC_STATUS.ACCEPTED).sort(byPriority)[0];
    if (nextAccepted) {
      try {
        await startPlaying(nextAccepted);
      } catch (error) {
        console.error(error);
      }
      return;
    }

    if (aiAutoAcceptRef.current) {
      const nextPending = snapshot.filter(isAutoAcceptEligible).sort(byPriority)[0];
      if (nextPending) {
        try {
          const accepted = await updateRec(cafe.slug, nextPending.id, REC_STATUS.ACCEPTED);
          storeRecommendation(accepted);
          await startPlaying(accepted);
        } catch (error) {
          console.error(error);
        }
        return;
      }
    }

    window.electronAPI?.endRec();
  }

  // AI 통과 pending을 accepted로 승격하고 재생 중인 곡이 없으면 첫 곡을 시작한다.
  async function drainPendingAndPlay(base) {
    if (!playbackLeaderRef.current) return;
    let snapshot = base || recommendationsRef.current;
    const pendingList = snapshot.filter(isAutoAcceptEligible);

    if (pendingList.length > 0) {
      const updates = (await Promise.all(
        pendingList.map(rec => updateRec(cafe.slug, rec.id, REC_STATUS.ACCEPTED).catch(() => null))
      )).filter(Boolean);
      const updateMap = Object.fromEntries(updates.map(update => [update.id, update]));
      snapshot = snapshot.map(rec => updateMap[rec.id] || rec);
      recommendationsRef.current = snapshot;
      setRecommendations(previous => previous.map(rec => updateMap[rec.id] || rec));
    }

    if (snapshot.some(rec => rec.status === REC_STATUS.PLAYING)) return;

    const firstAccepted = snapshot.filter(rec => rec.status === REC_STATUS.ACCEPTED).sort(byPriority)[0];
    if (!firstAccepted) return;

    try {
      await startPlaying(firstAccepted);
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    setIsPlaybackLeader(false);
    setLoading(true);

    const recommendationsLoaded = getRecommendations(cafe.slug)
      .then(({ recommendations: loaded, is_accepting }) => {
        // playing 복구는 socket 리더가 된 Electron 한 대만 수행한다.
        setRecommendations(loaded);
        setIsAccepting(is_accepting);
        return loaded;
      })
      .catch(error => {
        console.error(error);
        return null;
      })
      .finally(() => setLoading(false));

    const cafeLoaded = getMe().then(latest => {
      setCafe(previous => {
        const updated = {
          ...previous,
          name: latest.name || previous.name,
          notice: latest.notice ?? previous.notice,
          initial_slug: latest.initial_slug || previous.initial_slug,
        };
        localStorage.setItem('cafe', JSON.stringify(updated));
        return updated;
      });
      if (latest.allowed_platforms) setAllowedPlatforms(parseAllowedPlatforms(latest.allowed_platforms));
      if (latest.customer_url) setCustomerUrl(latest.customer_url);
      setAiAutoAccept(!!latest.music_filter_enabled);
      return latest;
    }).catch(() => null);

    const socket = getSocket(cafe.slug);
    let connected = false;

    socket.on('connect', () => {
      socket.emit('request_playback_role');
      if (!connected) {
        connected = true;
        return;
      }
      getRecommendations(cafe.slug)
        .then(({ recommendations: latest, is_accepting }) => {
          setRecommendations(latest);
          setIsAccepting(is_accepting);
        })
        .catch(() => {});
    });

    socket.on('playback_role', async ({ isLeader, shouldRecover }) => {
      const next = playbackAvailable && isLeader === true;
      playbackLeaderRef.current = next;
      setIsPlaybackLeader(next);
      // 리더 승격 알림은 먼저 역할만 전달한다. 별도 요청으로 recovery
      // claim을 원자적으로 한 번만 소비한다.
      if (next && shouldRecover === undefined) {
        socket.emit('request_playback_role');
        return;
      }
      if (!next || !shouldRecover) return;

      const recoveryMarker = `cf_playback_initialized:${cafe.slug}`;
      if (sessionStorage.getItem(recoveryMarker) === '1') return;
      sessionStorage.setItem(recoveryMarker, '1');

      try {
        const [{ recommendations: latest, is_accepting }, latestCafe] = await Promise.all([
          getRecommendations(cafe.slug),
          cafeLoaded,
        ]);
        // 새 리더 세션이 시작되었을 때만 서버에 남은 가짜 playing을
        // accepted로 복구한다. follower·브라우저·renderer reload는 건드리지 않는다.
        const reset = await Promise.all(latest.map(rec => rec.status === REC_STATUS.PLAYING
          ? updateRec(cafe.slug, rec.id, REC_STATUS.ACCEPTED).catch(() => rec)
          : rec));
        recommendationsRef.current = reset;
        setRecommendations(reset);
        setIsAccepting(is_accepting);
        if (latestCafe?.music_filter_enabled) await drainPendingAndPlay(reset);
      } catch (error) {
        console.error(error);
      }
    });

    socket.on('owner_recommendations_update', ({ action, rec, id }) => {
      if (action === 'add') {
        // 서버 판단과 별개로 클라이언트에서도 filter_status=accepted를 재확인한다.
        if (aiAutoAcceptRef.current && isAutoAcceptEligible(rec)) {
          updateRec(cafe.slug, rec.id, REC_STATUS.ACCEPTED)
            .then(updated => {
              recommendationsRef.current = recommendationsRef.current.some(item => item.id === updated.id)
                ? recommendationsRef.current.map(item => item.id === updated.id ? updated : item)
                : [...recommendationsRef.current, updated];
              setRecommendations(recommendationsRef.current);
              if (playbackLeaderRef.current) startPlaying(updated).catch(console.error);
            })
            .catch(() => {
              setRecommendations(previous => previous.some(item => item.id === rec.id) ? previous : [rec, ...previous]);
            });
        } else {
          setRecommendations(previous => previous.some(item => item.id === rec.id) ? previous : [rec, ...previous]);
        }
      }
      if (action === 'update' || action === 'vote') {
        setRecommendations(previous => previous.map(item => item.id === rec.id ? rec : item));
      }
      if (action === 'delete') {
        setRecommendations(previous => previous.filter(item => item.id !== id));
      }
    });

    socket.on('system_toggled', ({ is_accepting }) => setIsAccepting(is_accepting));

    const removeNowPlaying = window.electronAPI?.onNowPlaying(info => setNowPlaying(info));
    // owner UI는 Railway에서 최신 버전을 불러오므로 설치본 preload보다 앞설 수 있다.
    // 구버전 Electron에는 이 채널이 없어도 Dashboard 렌더링을 계속한다.
    const removePlaybackState = window.electronAPI?.onPlaybackState?.(state => {
      if (!playbackLeaderRef.current) return;
      const playing = recommendationsRef.current.find(rec => rec.status === REC_STATUS.PLAYING);
      socket.emit('playback_state', {
        state: Object.values(PLAYBACK_STATE).includes(state) ? state : PLAYBACK_STATE.UNKNOWN,
        recommendationId: playing?.id || null,
      });
    });
    const removeWidevineStatus = window.electronAPI?.onWidevineStatus(status => setWidevineStatus(status));

    const savedBgmUrl = savedToBgmUrl(readSavedBgm());
    if (savedBgmUrl) window.electronAPI?.setBgmUrl(savedBgmUrl);

    const removeVideoEnded = window.electronAPI?.onVideoEnded(() => {
      if (!playbackLeaderRef.current) return;
      const playing = recommendationsRef.current.find(rec => rec.status === REC_STATUS.PLAYING);
      if (!playing) return;
      updateRec(cafe.slug, playing.id, REC_STATUS.PLAYED)
        .then(updated => {
          storeRecommendation(updated);
          playNextOrStop(recommendationsRef.current);
        })
        .catch(console.error);
    });

    const removeCleanupBeforeQuit = window.electronAPI?.onCleanupBeforeQuit?.(async () => {
      try {
        const playing = playbackLeaderRef.current
          ? recommendationsRef.current.filter(rec => rec.status === REC_STATUS.PLAYING)
          : [];
        await Promise.all(
          playing.map(rec => updateRec(cafe.slug, rec.id, REC_STATUS.PLAYED).catch(() => null))
        );
      } catch {}
      window.electronAPI?.cleanupDone?.();
    });

    return () => {
      disconnectSocket();
      if (typeof removeNowPlaying === 'function') removeNowPlaying();
      if (typeof removePlaybackState === 'function') removePlaybackState();
      if (typeof removeWidevineStatus === 'function') removeWidevineStatus();
      if (typeof removeVideoEnded === 'function') removeVideoEnded();
      if (typeof removeCleanupBeforeQuit === 'function') removeCleanupBeforeQuit();
    };
  }, [cafe.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleAccepting() {
    const next = !isAccepting;
    setIsAccepting(next);
    try {
      await setStatus(next);
    } catch {
      setIsAccepting(!next);
      alert('신청 상태를 변경하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  async function toggleAiAutoAccept() {
    const next = !aiAutoAccept;
    let latest;

    try {
      latest = await getMe();
    } catch {
      alert('설정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }

    const prompt = (latest.music_filter_prompt || '').trim();
    if (next && !prompt) {
      alert('AI 자동수락을 켜려면 설정에서 매장 분위기 설명을 먼저 입력해 주세요.');
      onPromptRequired();
      return;
    }

    try {
      await updateMusicFilter({
        enabled: next,
        prompt: prompt || null,
      });
    } catch (error) {
      alert(error.message || 'AI 자동수락 설정을 저장하지 못했어요. 다시 시도해 주세요.');
      return;
    }

    setAiAutoAccept(next);
    if (next && playbackLeaderRef.current) await drainPendingAndPlay();
  }

  function handleUpdate(updated, context) {
    storeRecommendation(updated);

    if (context === REC_STATUS.PLAYING && updated.status !== REC_STATUS.PLAYING) {
      if ([REC_STATUS.PLAYED, REC_STATUS.SKIPPED].includes(updated.status)) {
        if (playbackLeaderRef.current) playNextOrStop(recommendationsRef.current);
      } else {
        // 재생 중 곡을 대기/신청 영역으로 되돌린 경우 같은 곡을 즉시 다시
        // 시작하지 않고 실제 플레이어도 BGM으로 복귀시킨다.
        if (playbackLeaderRef.current) window.electronAPI?.endRec();
      }
      return;
    }

    if (updated.status === REC_STATUS.ACCEPTED && playbackLeaderRef.current) {
      startPlaying(updated).catch(console.error);
    }
  }

  function handleDelete(id) {
    setRecommendations(previous => previous.filter(rec => rec.id !== id));
  }

  return {
    recommendations,
    setRecommendations,
    recommendationsRef,
    isAccepting,
    nowPlaying,
    loading,
    widevineStatus,
    aiAutoAccept,
    canControlPlayback: playbackAvailable && isPlaybackLeader,
    toggleAccepting,
    toggleAiAutoAccept,
    handleUpdate,
    handleDelete,
  };
}
