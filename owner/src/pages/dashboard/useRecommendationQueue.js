import { useEffect, useRef, useState } from 'react';
import { getRecommendations, updateRec, setStatus, getMe, updateMusicFilter } from '../../api';
import { getSocket, disconnectSocket } from '../../socket';
import { parseAllowedPlatforms } from '../../constants/platforms';
import { REC_STATUS } from '../../constants/recommendationStatus';
import { readSavedBgm, savedToBgmUrl } from './bgmStorage';
import { byPriority, isAutoAcceptEligible } from './queuePolicy';

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
  const aiAutoAcceptRef = useRef(aiAutoAccept);
  const playingTransitionRef = useRef(false);

  recommendationsRef.current = recommendations;
  aiAutoAcceptRef.current = aiAutoAccept;

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
    if (playingTransitionRef.current) return null;
    if (recommendationsRef.current.some(item => item.status === REC_STATUS.PLAYING)) return null;

    playingTransitionRef.current = true;
    try {
      const playing = await updateRec(cafe.slug, rec.id, REC_STATUS.PLAYING);
      storeRecommendation(playing);
      window.electronAPI?.playRec(playing.video_id);
      return playing;
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
    setLoading(true);

    const recommendationsLoaded = getRecommendations(cafe.slug)
      .then(async ({ recommendations: loaded, is_accepting }) => {
        // 앱 재시작 시 playing을 accepted로 되돌려 가짜 재생 상태를 제거한다.
        const playingRecommendations = loaded.filter(rec => rec.status === REC_STATUS.PLAYING);
        let finalList = loaded;
        if (playingRecommendations.length > 0) {
          const reset = await Promise.all(
            playingRecommendations.map(rec => updateRec(cafe.slug, rec.id, REC_STATUS.ACCEPTED).catch(() => rec))
          );
          const resetMap = Object.fromEntries(reset.map(rec => [rec.id, rec]));
          finalList = loaded.map(rec => resetMap[rec.id] ?? rec);
        }
        setRecommendations(finalList);
        setIsAccepting(is_accepting);
        return finalList;
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

    Promise.all([recommendationsLoaded, cafeLoaded]).then(([list, latestCafe]) => {
      if (list && latestCafe?.music_filter_enabled) drainPendingAndPlay(list);
    });

    const socket = getSocket(cafe.slug);
    let connected = false;

    socket.on('connect', () => {
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

    socket.on('recommendations_update', ({ action, rec, id }) => {
      if (action === 'add') {
        // 서버 판단과 별개로 클라이언트에서도 filter_status=accepted를 재확인한다.
        if (aiAutoAcceptRef.current && isAutoAcceptEligible(rec)) {
          updateRec(cafe.slug, rec.id, REC_STATUS.ACCEPTED)
            .then(updated => {
              recommendationsRef.current = recommendationsRef.current.some(item => item.id === updated.id)
                ? recommendationsRef.current.map(item => item.id === updated.id ? updated : item)
                : [...recommendationsRef.current, updated];
              setRecommendations(recommendationsRef.current);
              startPlaying(updated).catch(console.error);
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
    const removeWidevineStatus = window.electronAPI?.onWidevineStatus(status => setWidevineStatus(status));

    const savedBgmUrl = savedToBgmUrl(readSavedBgm());
    if (savedBgmUrl) window.electronAPI?.setBgmUrl(savedBgmUrl);

    const removeVideoEnded = window.electronAPI?.onVideoEnded(() => {
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
        const playing = recommendationsRef.current.filter(rec => rec.status === REC_STATUS.PLAYING);
        await Promise.all(
          playing.map(rec => updateRec(cafe.slug, rec.id, REC_STATUS.PLAYED).catch(() => null))
        );
      } catch {}
      window.electronAPI?.cleanupDone?.();
    });

    return () => {
      disconnectSocket();
      if (typeof removeNowPlaying === 'function') removeNowPlaying();
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
    }
  }

  async function toggleAiAutoAccept() {
    const next = !aiAutoAccept;
    let latest;

    try {
      latest = await getMe();
    } catch {
      alert('설정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    const prompt = (latest.music_filter_prompt || '').trim();
    if (next && !prompt) {
      alert('AI 자동수락을 켜려면 설정 탭에서 매장 분위기 설명을 먼저 입력해주세요.');
      onPromptRequired();
      return;
    }

    try {
      await updateMusicFilter({
        enabled: next,
        prompt: prompt || null,
        strictness: latest.music_filter_strictness || undefined,
      });
    } catch (error) {
      alert(error.message || 'AI 자동수락 설정 저장에 실패했습니다.');
      return;
    }

    setAiAutoAccept(next);
    if (next) await drainPendingAndPlay();
  }

  function handleUpdate(updated, context) {
    storeRecommendation(updated);

    if (context === REC_STATUS.PLAYING && updated.status === REC_STATUS.SKIPPED) {
      playNextOrStop(recommendationsRef.current);
      return;
    }

    if (updated.status === REC_STATUS.ACCEPTED) {
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
    toggleAccepting,
    toggleAiAutoAccept,
    handleUpdate,
    handleDelete,
  };
}
