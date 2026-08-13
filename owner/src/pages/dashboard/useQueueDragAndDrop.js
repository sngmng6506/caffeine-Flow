import { useState } from 'react';
import { createRec, updateRec } from '../../api';
import { REC_STATUS } from '../../constants/recommendationStatus';

const DEFAULT_DROP_TARGET = 'default';

export default function useQueueDragAndDrop({
  cafeSlug,
  recommendations,
  setRecommendations,
  onRecommendationUpdate,
  onSetDefault,
  onClearDefault,
}) {
  const [dragOver, setDragOver] = useState(null);
  const [error, setError] = useState('');

  async function handleDrop(event, targetStatus) {
    event.preventDefault();
    setDragOver(null);
    setError('');

    try {
      const data = JSON.parse(event.dataTransfer.getData('text/plain'));

      if (data.type === DEFAULT_DROP_TARGET) {
        const rec = await createRec(cafeSlug, {
          videoId: data.videoId,
          title: data.title,
          thumbnail: data.thumbnail,
          status: targetStatus,
        });
        setRecommendations(previous => {
          const cleared = targetStatus === REC_STATUS.PLAYING
            ? previous.map(item => item.status === REC_STATUS.PLAYING ? { ...item, status: REC_STATUS.PLAYED } : item)
            : previous;
          return cleared.some(item => item.id === rec.id) ? cleared : [...cleared, rec];
        });
        onClearDefault();
        if (targetStatus === REC_STATUS.PLAYING) window.electronAPI?.playRec(data.videoId);
        return;
      }

      const { id, status: fromStatus } = data;
      if (fromStatus === targetStatus) return;
      const rec = recommendations.find(item => item.id === id);
      if (!rec) return;

      const updated = await updateRec(cafeSlug, id, targetStatus);
      if (targetStatus === REC_STATUS.PLAYING) {
        setRecommendations(previous => previous.map(item => (
          item.id !== updated.id && item.status === REC_STATUS.PLAYING
            ? { ...item, status: REC_STATUS.PLAYED }
            : item
        )));
      }
      onRecommendationUpdate(updated, fromStatus);
      if (targetStatus === REC_STATUS.PLAYING) window.electronAPI?.playRec(rec.video_id);
    } catch (error) {
      console.error(error);
      setError('곡 위치를 변경하지 못했어요. 다시 시도해 주세요.');
    }
  }

  function handleDropToDefault(event) {
    event.preventDefault();
    setDragOver(null);
    setError('');

    try {
      const data = JSON.parse(event.dataTransfer.getData('text/plain'));
      if (data.type === DEFAULT_DROP_TARGET) return;
      const rec = recommendations.find(item => item.id === data.id);
      if (!rec) return;
      onSetDefault({ videoId: rec.video_id, title: rec.title, thumbnail: rec.thumbnail });
    } catch (error) {
      console.error(error);
      setError('기본 BGM을 변경하지 못했어요. 다시 시도해 주세요.');
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
