import { REC_STATUS } from '../../constants/recommendationStatus';
import RecommendCard from '../RecommendCard';
import DefaultSection from './DefaultSection';
import { byPriority } from './queuePolicy';

const DEFAULT_DROP_TARGET = 'default';

export default function QueueTab({
  recommendations,
  loading,
  dragOver,
  defaultVideo,
  nowPlaying,
  widevineStatus,
  slug,
  error,
  onDragOver,
  onDragLeave,
  onDrop,
  onDropToDefault,
  onSetDefault,
  onClearDefault,
  onUpdate,
  onDelete,
}) {
  const playing = recommendations.filter(r => r.status === REC_STATUS.PLAYING);
  const accepted = recommendations.filter(r => r.status === REC_STATUS.ACCEPTED).sort(byPriority);
  const pending = recommendations.filter(r => r.status === REC_STATUS.PENDING).sort(byPriority);

  return (
    <>
      {error && <div role="alert" className="owner-queue-error">{error}</div>}
      <div className="owner-queue">
      <section
        className={`owner-queue-section ${dragOver === DEFAULT_DROP_TARGET ? 'owner-queue-section--drag-over' : ''}`}
        onDragOver={event => onDragOver(event, DEFAULT_DROP_TARGET)}
        onDragLeave={onDragLeave}
        onDrop={onDropToDefault}
      >
        <div className="owner-queue-section__header">
          <h2 className="owner-queue-section__title">기본 BGM</h2>
        </div>
        <DefaultSection
          defaultVideo={defaultVideo}
          isPlaying={!nowPlaying && !!defaultVideo}
          onSet={onSetDefault}
          onClear={onClearDefault}
          widevineStatus={widevineStatus}
        />
      </section>

      <section
        className={`owner-queue-section owner-queue-section--playing ${dragOver === REC_STATUS.PLAYING ? 'owner-queue-section--drag-over' : ''}`}
        onDragOver={event => onDragOver(event, REC_STATUS.PLAYING)}
        onDragLeave={onDragLeave}
        onDrop={event => onDrop(event, REC_STATUS.PLAYING)}
      >
        <div className="owner-queue-section__header">
          <h2 className="owner-queue-section__title">재생 중</h2>
        </div>
        {loading
          ? <div className="owner-empty">신청곡을 불러오고 있어요.</div>
          : playing.length > 0
            ? playing.map(rec => (
                <RecommendCard
                  key={rec.id}
                  slug={slug}
                  rec={rec}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  context={REC_STATUS.PLAYING}
                />
              ))
            : <div className="owner-empty">재생 중인 신청곡이 없어요.</div>
        }
      </section>

      <section
        className={`owner-queue-section ${dragOver === REC_STATUS.ACCEPTED ? 'owner-queue-section--drag-over' : ''}`}
        onDragOver={event => onDragOver(event, REC_STATUS.ACCEPTED)}
        onDragLeave={onDragLeave}
        onDrop={event => onDrop(event, REC_STATUS.ACCEPTED)}
      >
        <div className="owner-queue-section__header">
          <h2 className="owner-queue-section__title">대기 곡</h2>
          {accepted.length > 0 && <span className="owner-count">{accepted.length}</span>}
        </div>
        {loading
          ? <div className="owner-empty">신청곡을 불러오고 있어요.</div>
          : accepted.length > 0
            ? accepted.map((rec, index) => (
                <RecommendCard
                  key={rec.id}
                  slug={slug}
                  rec={rec}
                  position={index + 1}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  context={REC_STATUS.ACCEPTED}
                />
              ))
            : <div className="owner-empty">대기 중인 곡이 없어요.</div>
        }
      </section>

      <section
        className={`owner-queue-section ${dragOver === REC_STATUS.PENDING ? 'owner-queue-section--drag-over' : ''}`}
        onDragOver={event => onDragOver(event, REC_STATUS.PENDING)}
        onDragLeave={onDragLeave}
        onDrop={event => onDrop(event, REC_STATUS.PENDING)}
      >
        <div className="owner-queue-section__header">
          <h2 className="owner-queue-section__title">새 신청</h2>
          {pending.length > 0 && <span className="owner-count">{pending.length}</span>}
        </div>
        {loading
          ? <div className="owner-empty">신청곡을 불러오고 있어요.</div>
          : pending.length > 0
            ? pending.map((rec, index) => (
                <RecommendCard
                  key={rec.id}
                  slug={slug}
                  rec={rec}
                  position={index + 1}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  context={REC_STATUS.PENDING}
                />
              ))
            : <div className="owner-empty">새로 들어온 신청곡이 없어요.</div>
        }
      </section>
      </div>
    </>
  );
}
