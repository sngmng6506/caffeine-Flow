import { useState } from 'react';
import { createRec, deleteRec, updateRec } from '../../api';
import { REC_STATUS } from '../../constants/recommendationStatus';
import { recommendationToDefault } from './musicResource.mjs';
import { requestElectronPlayback } from './playbackBridge.mjs';
import { runPlaybackTransition } from './playbackTransition.mjs';

const DEFAULT_DROP_TARGET = 'default';

export default function useQueueDragAndDrop({
  cafeSlug,
  recommendations,
  setRecommendations,
  onRecommendationUpdate,
  onSetDefault,
  onClearDefault,
  canControlPlayback,
}) {
  const [dragOver, setDragOver] = useState(null);
  const [error, setError] = useState('');

  async function restorePreviousPlayback(replacementId) {
    window.electronAPI?.endRec();
    const previous = recommendations.find(item =>
      item.status === REC_STATUS.PLAYING && item.id !== replacementId);
    if (previous) await requestElectronPlayback(window.electronAPI, previous.video_id);
  }

  async function handleDrop(event, targetStatus) {
    event.preventDefault();
    setDragOver(null);
    setError('');

    try {
      const data = JSON.parse(event.dataTransfer.getData('text/plain'));
      if (targetStatus === REC_STATUS.PLAYING && !canControlPlayback) {
        throw new Error('재생을 담당하는 Electron 앱에서만 재생 중으로 옮길 수 있습니다.');
      }
      if (targetStatus === REC_STATUS.PLAYING
        && recommendations.some(item => item.status === REC_STATUS.PLAYING && item.id !== data.id)) {
        throw new Error('현재 재생 중인 곡을 먼저 종료한 뒤 새 곡을 재생해 주세요.');
      }

      if (data.type === DEFAULT_DROP_TARGET) {
        const requestedStatus = targetStatus === REC_STATUS.PLAYING
          ? REC_STATUS.ACCEPTED
          : targetStatus;
        const created = await createRec(cafeSlug, {
          videoId: data.videoId,
          title: data.title,
          channelTitle: data.channelTitle,
          thumbnail: data.thumbnail,
          duration: data.duration,
          platform: data.platform,
          status: requestedStatus,
        });
        let rec = created;
        if (targetStatus === REC_STATUS.PLAYING) {
          const { type: _type, ...defaultSnapshot } = data;
          let defaultCleared = false;
          try {
            // Spotify 기본 BGM을 같은 bgmView에서 takeover한 뒤 clear하면
            // 신청곡까지 중단된다. 먼저 기본 BGM을 해제해 recView 재생으로 전환한다.
            rec = await runPlaybackTransition(async () => {
              await onClearDefault();
              defaultCleared = true;
              try {
                const result = await requestElectronPlayback(window.electronAPI, created.video_id);
                if (!result?.ok) throw new Error(result?.error || '신청곡 재생을 시작하지 못했습니다.');
                return await updateRec(cafeSlug, created.id, REC_STATUS.PLAYING);
              } catch (error) {
                await restorePreviousPlayback(created.id);
                throw error;
              }
            });
          } catch (error) {
            if (defaultCleared) await onSetDefault(defaultSnapshot).catch(console.error);
            await deleteRec(cafeSlug, created.id).catch(() => null);
            throw error;
          }
        }
        if (targetStatus !== REC_STATUS.PLAYING) {
          try {
            await onClearDefault();
          } catch (error) {
            await deleteRec(cafeSlug, created.id).catch(() => null);
            throw error;
          }
        }
        setRecommendations(previous => {
          const cleared = targetStatus === REC_STATUS.PLAYING
            ? previous.map(item => item.status === REC_STATUS.PLAYING ? { ...item, status: REC_STATUS.PLAYED } : item)
            : previous;
          return cleared.some(item => item.id === rec.id) ? cleared : [...cleared, rec];
        });
        return;
      }

      const { id, status: fromStatus } = data;
      if (fromStatus === targetStatus) return;
      const rec = recommendations.find(item => item.id === id);
      if (!rec) return;

      if (fromStatus === REC_STATUS.PLAYING && !canControlPlayback) {
        throw new Error('재생을 담당하는 Electron 앱에서만 재생 중인 곡을 옮길 수 있습니다.');
      }

      let updated;
      if (targetStatus === REC_STATUS.PLAYING) {
        updated = await runPlaybackTransition(async () => {
          try {
            const result = await requestElectronPlayback(window.electronAPI, rec.video_id);
            if (!result?.ok) throw new Error(result?.error || '신청곡 재생을 시작하지 못했습니다.');
            return await updateRec(cafeSlug, id, targetStatus);
          } catch (error) {
            await restorePreviousPlayback(id);
            throw error;
          }
        });
      } else {
        updated = await updateRec(cafeSlug, id, targetStatus);
      }
      if (targetStatus === REC_STATUS.PLAYING) {
        setRecommendations(previous => previous.map(item => (
          item.id !== updated.id && item.status === REC_STATUS.PLAYING
            ? { ...item, status: REC_STATUS.PLAYED }
            : item
        )));
      }
      onRecommendationUpdate(updated, fromStatus);
    } catch (error) {
      console.error(error);
      setError(error.message || '곡 위치를 변경하지 못했어요. 다시 시도해 주세요.');
    }
  }

  async function handleDropToDefault(event) {
    event.preventDefault();
    setDragOver(null);
    setError('');

    try {
      const data = JSON.parse(event.dataTransfer.getData('text/plain'));
      if (data.type === DEFAULT_DROP_TARGET) return;
      const rec = recommendations.find(item => item.id === data.id);
      if (!rec) return;
      if (rec.status === REC_STATUS.PLAYING && !canControlPlayback) {
        throw new Error('재생을 담당하는 Electron 앱에서만 재생 중인 곡을 옮길 수 있습니다.');
      }

      const terminalStatus = rec.status === REC_STATUS.PLAYING
        ? REC_STATUS.PLAYED
        : REC_STATUS.SKIPPED;
      await updateRec(cafeSlug, rec.id, terminalStatus);
      if (rec.status === REC_STATUS.PLAYING) window.electronAPI?.endRec();
      setRecommendations(previous => previous.filter(item => item.id !== rec.id));
      await onSetDefault(recommendationToDefault(rec));
    } catch (error) {
      console.error(error);
      setError(error.message || '기본 BGM을 변경하지 못했어요. 다시 시도해 주세요.');
    }
  }

  function handleDragOver(event, target) {
    event.preventDefault();
    setDragOver(target);
  }

  return {
    dragOver,
    clearDragOver: () => setDragOver(null),
    handleDragOver,
    handleDrop,
    handleDropToDefault,
    error,
  };
}
