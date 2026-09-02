import { useEffect, useRef, useState } from 'react';
import { finalizeManualPlayback, getRecommendations, updateRec, setStatus, getMe, updateMusicFilter } from '../../api';
import { getSocket, disconnectSocket } from '../../socket';
import { parseAllowedPlatforms } from '../../constants/platforms';
import { REC_STATUS } from '../../constants/recommendationStatus';
import { PLAYBACK_STATE } from '../../constants/playbackState';
import { readSavedBgm, savedToBgmUrl } from './bgmStorage';
import { isAutoAcceptEligible } from './queuePolicy';
import { createPlaybackCommands } from './playbackCommands.mjs';
import { createPlaybackRoleFlow } from './playbackRoleFlow.mjs';
import { subscribeElectron } from './electronSubscriptions.mjs';
import { finishCurrentPlayback } from './playbackCleanup.mjs';

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
  const [currentTrack, setCurrentTrack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [widevineStatus, setWidevineStatus] = useState(null);
  const [aiAutoAccept, setAiAutoAccept] = useState(false);
  const [isAcceptingReady, setIsAcceptingReady] = useState(false);
  const [aiFilterReady, setAiFilterReady] = useState(false);
  const [isPlaybackLeader, setIsPlaybackLeader] = useState(false);
  const aiAutoAcceptRef = useRef(aiAutoAccept);
  const playbackLeaderRef = useRef(false);
  const currentTrackRef = useRef(null);
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

  // 재생 명령은 playbackCommands.mjs가 담당한다. 훅은 최신 상태를 읽는
  // getter만 넘기고, 판단 순서와 Electron·서버 갱신 순서는 그쪽 계약이다.
  const { startPlaying, playNextOrStop, drainPendingAndPlay } = createPlaybackCommands({
    getSlug: () => cafe.slug,
    getElectronApi: () => window.electronAPI,
    updateRec,
    isPlaybackAvailable: () => playbackAvailable,
    isLeader: () => playbackLeaderRef.current,
    isAutoAcceptOn: () => aiAutoAcceptRef.current,
    getRecommendations: () => recommendationsRef.current,
    storeRecommendation,
    replaceRecommendations: (snapshot) => {
      recommendationsRef.current = snapshot;
      setRecommendations(snapshot);
    },
  });

  useEffect(() => {
    setIsPlaybackLeader(false);
    setLoading(true);
    setIsAcceptingReady(false);
    setAiFilterReady(false);

    const recommendationsLoaded = getRecommendations(cafe.slug)
      .then(({ recommendations: loaded, is_accepting }) => {
        // playing 복구는 socket 리더가 된 Electron 한 대만 수행한다.
        setRecommendations(loaded);
        setIsAccepting(is_accepting);
        setIsAcceptingReady(true);
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
          initial_slug: latest.initial_slug || previous.initial_slug,
        };
        localStorage.setItem('cafe', JSON.stringify(updated));
        return updated;
      });
      if (latest.allowed_platforms) setAllowedPlatforms(parseAllowedPlatforms(latest.allowed_platforms));
      if (latest.customer_url) setCustomerUrl(latest.customer_url);
      setAiAutoAccept(!!latest.music_filter_enabled);
      setAiFilterReady(true);
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
          setIsAcceptingReady(true);
        })
        .catch(() => {});
    });

    const roleFlow = createPlaybackRoleFlow({
      socket,
      getSlug: () => cafe.slug,
      getElectronApi: () => window.electronAPI,
      getRecommendations,
      updateRec,
      getCafeSettings: () => cafeLoaded,
      onLeaderChange: (isLeader) => {
        playbackLeaderRef.current = isLeader;
        setIsPlaybackLeader(isLeader);
      },
      onRecovered: (reset, accepting) => {
        recommendationsRef.current = reset;
        setRecommendations(reset);
        setIsAccepting(accepting);
      },
      drainPendingAndPlay,
    });

    socket.on('playback_role', payload => roleFlow.handleRole(payload, { playbackAvailable }));

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

    const publishPlaybackState = state => {
      if (!playbackLeaderRef.current) return;
      const playing = recommendationsRef.current.find(rec => rec.status === REC_STATUS.PLAYING);
      socket.emit('playback_state', {
        state: Object.values(PLAYBACK_STATE).includes(state) ? state : PLAYBACK_STATE.UNKNOWN,
        recommendationId: playing?.id || null,
        track: currentTrackRef.current,
      });
    };

    // 재생 리더만 곡을 종료 상태로 넘긴다. follower가 같은 이벤트를 받아도
    // DB를 건드리면 두 화면이 같은 곡을 두 번 종료시킨다.
    const endPlayingAs = (status, { playNext } = {}) => () => {
      if (!playbackLeaderRef.current) return;
      const playing = recommendationsRef.current.find(rec => rec.status === REC_STATUS.PLAYING);
      if (!playing) return;
      updateRec(cafe.slug, playing.id, status)
        .then(updated => {
          storeRecommendation(updated);
          if (playNext) playNextOrStop(recommendationsRef.current);
        })
        .catch(console.error);
    };

    const savedBgmUrl = savedToBgmUrl(readSavedBgm(cafe.id));
    if (savedBgmUrl) window.electronAPI?.setBgmUrl(savedBgmUrl);

    // 구버전 설치본에 없는 채널은 subscribeElectron이 건너뛴다.
    const unsubscribeElectron = subscribeElectron(window.electronAPI, {
      onNowPlaying: info => setNowPlaying(info),
      onPlaybackState: publishPlaybackState,
      onCurrentTrack: track => {
        currentTrackRef.current = track && typeof track === 'object' ? track : null;
        setCurrentTrack(currentTrackRef.current);
        publishPlaybackState(currentTrackRef.current ? PLAYBACK_STATE.PLAYING : PLAYBACK_STATE.UNKNOWN);
      },
      onManualTrackEnded: track => {
        finalizeManualPlayback(track).catch(error => console.error('[manual playback history]', error));
      },
      onWidevineStatus: status => setWidevineStatus(status),
      onVideoEnded: endPlayingAs(REC_STATUS.PLAYED, { playNext: true }),
      // 사장님이 신청곡 재생 중 플레이어를 다른 곳으로 옮기면 원곡만 played로
      // 종료한다. 정상 종료와 달리 다음 곡을 자동 재생하지 않는다 — 사장님이
      // 직접 플레이어를 조작 중이므로 방해하지 않는다.
      onRecLeft: endPlayingAs(REC_STATUS.PLAYED),
      onCleanupBeforeQuit: async () => {
        try {
          await finishPlaybackForExit();
        } catch {
          // 종료 정리는 실패해도 앱 종료를 막지 않는다
        }
        window.electronAPI?.cleanupDone?.();
      },
    });

    return () => {
      roleFlow.dispose();
      disconnectSocket();
      unsubscribeElectron();
    };
  }, [cafe.id, cafe.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleAccepting() {
    const next = !isAccepting;
    setIsAccepting(next);
    try {
      await setStatus(next);
      setIsAcceptingReady(true);
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
      alert('AI 필터를 켜려면 설정에서 매장 분위기 설명을 먼저 입력해 주세요.');
      onPromptRequired();
      return;
    }

    try {
      await updateMusicFilter({
        enabled: next,
        prompt: prompt || null,
      });
    } catch (error) {
      alert(error.message || 'AI 필터 설정을 저장하지 못했어요. 다시 시도해 주세요.');
      return;
    }

    setAiAutoAccept(next);
    setAiFilterReady(true);
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

  async function finishPlaybackForExit() {
    const updated = await finishCurrentPlayback({
      isLeader: playbackLeaderRef.current,
      recommendations: recommendationsRef.current,
      markPlayed: rec => updateRec(cafe.slug, rec.id, REC_STATUS.PLAYED),
      endPlayback: () => window.electronAPI?.endRec(),
    });
    if (updated.length > 0) {
      const updateMap = Object.fromEntries(updated.map(rec => [rec.id, rec]));
      recommendationsRef.current = recommendationsRef.current.map(rec => updateMap[rec.id] || rec);
      setRecommendations(recommendationsRef.current);
    }
    return updated;
  }

  return {
    recommendations,
    setRecommendations,
    recommendationsRef,
    isAccepting,
    nowPlaying,
    currentTrack,
    loading,
    widevineStatus,
    aiAutoAccept,
    isAcceptingReady,
    aiFilterReady,
    canControlPlayback: playbackAvailable && isPlaybackLeader,
    toggleAccepting,
    toggleAiAutoAccept,
    finishPlaybackForExit,
    handleUpdate,
    handleDelete,
  };
}
