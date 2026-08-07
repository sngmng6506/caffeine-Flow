import { REC_STATUS } from '../../constants/recommendationStatus';
import RecommendCard from '../RecommendCard';
import DefaultSection from './DefaultSection';
import { dashboardStyles as styles } from './dashboardStyles';
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
  const hasPlaying = playing.length > 0;

  return (
    <div>
      <div
        style={{ ...styles.section, ...(dragOver === DEFAULT_DROP_TARGET ? styles.sectionDragOver : {}) }}
        onDragOver={event => onDragOver(event, DEFAULT_DROP_TARGET)}
        onDragLeave={onDragLeave}
        onDrop={onDropToDefault}
      >
        <div style={styles.sectionTitle}>기본</div>
        <DefaultSection
          defaultVideo={defaultVideo}
          isPlaying={!nowPlaying && !!defaultVideo}
          onSet={onSetDefault}
          onClear={onClearDefault}
          widevineStatus={widevineStatus}
        />
      </div>

      <div
        style={{ ...styles.section, ...(dragOver === REC_STATUS.PLAYING ? styles.sectionDragOver : {}) }}
        onDragOver={event => onDragOver(event, REC_STATUS.PLAYING)}
        onDragLeave={onDragLeave}
        onDrop={event => onDrop(event, REC_STATUS.PLAYING)}
      >
        <div style={styles.sectionTitle}>수락</div>
        {loading
          ? <div style={styles.emptySlot}>불러오는 중...</div>
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
            : <div style={styles.emptySlot}>재생 중인 신청곡 없음</div>
        }
      </div>

      <div
        style={{ ...styles.section, ...(dragOver === REC_STATUS.ACCEPTED ? styles.sectionDragOver : {}) }}
        onDragOver={event => onDragOver(event, REC_STATUS.ACCEPTED)}
        onDragLeave={onDragLeave}
        onDrop={event => onDrop(event, REC_STATUS.ACCEPTED)}
      >
        <div style={styles.sectionTitle}>대기 곡</div>
        {loading
          ? <div style={styles.emptySlot}>불러오는 중...</div>
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
            : <div style={styles.emptySlot}>대기 중인 곡 없음</div>
        }
      </div>

      <div
        style={{ ...styles.section, ...(dragOver === REC_STATUS.PENDING ? styles.sectionDragOver : {}) }}
        onDragOver={event => onDragOver(event, REC_STATUS.PENDING)}
        onDragLeave={onDragLeave}
        onDrop={event => onDrop(event, REC_STATUS.PENDING)}
      >
        <div style={styles.sectionTitle}>
          신청곡 {pending.length > 0 && <span style={styles.badge}>{pending.length}</span>}
        </div>
        {loading
          ? <div style={styles.emptySlot}>불러오는 중...</div>
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
                  hasPlaying={hasPlaying}
                />
              ))
            : <div style={styles.emptySlot}>신청된 곡 없음</div>
        }
      </div>
    </div>
  );
}
