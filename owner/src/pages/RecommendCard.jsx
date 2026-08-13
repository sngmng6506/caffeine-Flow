import { useState } from 'react';
import { updateRec, deleteRec } from '../api';
import { REC_STATUS, OWNER_ACTION_STATUS } from '../constants/recommendationStatus';
import { FILTER_STATUS } from '../constants/musicFilterStatus';
import { PLATFORM_BADGE } from '../constants/platforms';

const HISTORY_STATUS_LABEL = {
  [REC_STATUS.PLAYED]: '재생 완료',
  [REC_STATUS.SKIPPED]: '건너뜀',
  [REC_STATUS.REJECTED]: '신청 불가',
};

function filterLabel(rec) {
  if (!rec.filter_status || rec.filter_status === FILTER_STATUS.SKIPPED) return null;
  if (rec.filter_status === FILTER_STATUS.ACCEPTED) return { text: 'AI 확인 완료', tone: 'accepted' };
  if (rec.filter_status === FILTER_STATUS.REJECTED) return { text: 'AI 신청 불가', tone: 'rejected' };
  if (rec.filter_status === FILTER_STATUS.ERROR_REJECTED) return { text: 'AI 확인 오류', tone: 'error' };
  return null;
}

function formatHistoryTime(rec) {
  const value = rec.played_at || rec.updated_at || rec.requested_at || rec.created_at;
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RecommendCard({
  slug,
  rec,
  onUpdate,
  onDelete,
  context,
  position,
  expanded,
  onToggle,
}) {
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [imageError, setImageError] = useState(false);
  const filter = filterLabel(rec);
  const platformBadge = PLATFORM_BADGE[rec.platform];
  const historyStatus = HISTORY_STATUS_LABEL[rec.status];
  const historyTime = !context ? formatHistoryTime(rec) : '';

  async function handle(action) {
    setLoading(true);
    setActionError('');
    try {
      if (action === 'delete') {
        await deleteRec(slug, rec.id);
        onDelete(rec.id);
      } else {
        const updated = await updateRec(slug, rec.id, action);
        onUpdate(updated, context);
      }
    } catch (error) {
      console.error(error.message);
      setActionError('곡 상태를 변경하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event) {
    if (!onToggle || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onToggle();
  }

  return (
    <div
      className={`owner-track-card ${onToggle ? 'owner-track-card--interactive' : ''}`}
      draggable={!!context}
      role={onToggle ? 'button' : undefined}
      tabIndex={onToggle ? 0 : undefined}
      aria-expanded={onToggle ? expanded : undefined}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      onDragStart={event => {
        if (event.target.closest('button')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData('text/plain', JSON.stringify({ id: rec.id, status: rec.status }));
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      {position && <span className="owner-track-card__position">{position}</span>}
      {rec.thumbnail && !imageError ? (
        <img
          src={rec.thumbnail}
          alt=""
          className="owner-track-card__thumb"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="owner-track-card__thumb owner-thumb-placeholder" aria-hidden="true">CF</div>
      )}
      <div className="owner-track-card__body">
        <div className="owner-track-card__title">{rec.title}</div>
        <div className="owner-track-card__meta">
          {platformBadge && (
            <span className="owner-platform-badge" style={{ background: platformBadge.color }}>
              {platformBadge.text}
            </span>
          )}
          {rec.channel_title}{rec.duration && ` · ${rec.duration}`}
          {rec.requester_name && ` · ${rec.requester_name} 신청`}
        </div>
        <div className="owner-track-card__meta">좋아요 {rec.vote_count || 0}</div>
        {filter && (
          <div className="owner-filter-row" title={rec.filter_reason || ''}>
            <span className={`owner-filter-badge owner-filter-badge--${filter.tone}`}>{filter.text}</span>
            {rec.filter_reason && <span className="owner-filter-reason">{rec.filter_reason}</span>}
          </div>
        )}
        {!context && (historyStatus || historyTime) && (
          <div className="owner-filter-row">
            {historyStatus && <span className="owner-history-status">{historyStatus}</span>}
            {historyTime && <span className="owner-filter-reason">{historyTime}</span>}
          </div>
        )}
      </div>

      <div className="owner-track-card__footer">
        {context === REC_STATUS.PLAYING && (
          <div className="owner-track-card__actions">
            <button
              type="button"
              onClick={() => handle(OWNER_ACTION_STATUS.SKIPPED)}
              disabled={loading}
              className="owner-btn owner-btn--secondary"
            >건너뛰기</button>
          </div>
        )}

        {context === REC_STATUS.ACCEPTED && (
          <div className="owner-track-card__actions">
            <button
              type="button"
              onClick={() => handle(OWNER_ACTION_STATUS.SKIPPED)}
              disabled={loading}
              className="owner-btn owner-btn--secondary"
            >건너뛰기</button>
          </div>
        )}

        {context === REC_STATUS.PENDING && (
          <div className="owner-track-card__actions">
            <button
              type="button"
              onClick={() => handle(OWNER_ACTION_STATUS.ACCEPTED)}
              disabled={loading}
              className="owner-btn owner-btn--primary"
            >수락</button>
            <button
              type="button"
              onClick={() => handle(OWNER_ACTION_STATUS.SKIPPED)}
              disabled={loading}
              className="owner-btn owner-btn--secondary"
            >건너뛰기</button>
          </div>
        )}

        {actionError && <div role="alert" className="owner-track-card__error">{actionError}</div>}
        {expanded !== undefined && (
          <span className="owner-comment-hint">댓글 {expanded ? '접기' : '보기'}</span>
        )}
      </div>
    </div>
  );
}
