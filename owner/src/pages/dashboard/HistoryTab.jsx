import { useEffect, useRef, useState } from 'react';
import { getHistory } from '../../api';
import RecommendCard from '../RecommendCard';
import OwnerCommentSection from './OwnerCommentSection';

function todayKstString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function HistoryTab({ active, slug, onUpdate, onDelete }) {
  const [history, setHistory] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const requestIdRef = useRef(0);

  function loadHistory(offset = 0, targetDate = date) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    return getHistory(offset, targetDate || null)
      .then(({ items, hasMore: nextHasMore }) => {
        if (requestId !== requestIdRef.current) return;
        setHistory(previous => offset === 0 ? items : [...previous, ...items]);
        setHasMore(nextHasMore);
      })
      .catch(fetchError => {
        if (requestId !== requestIdRef.current) return;
        console.error(fetchError);
        setError(fetchError.message || '이력을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }

  useEffect(() => {
    if (active && history.length === 0 && !loading) loadHistory(0);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDateChange(nextDate) {
    setDate(nextDate);
    setHistory([]);
    setHasMore(false);
    setError('');
    setExpandedId(null);
    loadHistory(0, nextDate || null);
  }

  if (!active) return null;

  const today = todayKstString();

  return (
    <div id="owner-panel-history" role="tabpanel" aria-labelledby="owner-tab-history" className="owner-history">
      <div className="owner-history__toolbar">
        <div className="owner-segmented" aria-label="이력 기간">
          <button
            type="button"
            onClick={() => handleDateChange('')}
            aria-pressed={!date}
            className={`owner-segmented__button ${!date ? 'owner-segmented__button--active' : ''}`}
          >전체</button>
          <button
            type="button"
            onClick={() => handleDateChange(today)}
            aria-pressed={date === today}
            className={`owner-segmented__button ${date === today ? 'owner-segmented__button--active' : ''}`}
          >오늘</button>
        </div>
        <input
          type="date"
          value={date}
          max={today}
          aria-label="이력 날짜 선택"
          onChange={event => handleDateChange(event.target.value)}
          className="owner-input owner-history__date"
        />
      </div>

      {loading && history.length === 0 && (
        <div className="owner-empty owner-empty--large">이력을 불러오고 있어요.</div>
      )}
      {!loading && !error && history.length === 0 && (
        <div className="owner-empty owner-empty--large">
          아직 이력이 없어요. 신청곡을 처리하면 여기에 표시돼요.
        </div>
      )}

      {error && (
        <div role="alert" className="owner-history__error">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => loadHistory(history.length > 0 ? history.length : 0, date)}
            disabled={loading}
            className="owner-btn owner-btn--secondary"
          >다시 불러오기</button>
        </div>
      )}

      <div className="owner-history__list">
        {history.map(rec => (
          <div key={rec.id}>
            <RecommendCard
              slug={slug}
              rec={rec}
              onUpdate={onUpdate}
              onDelete={onDelete}
              expanded={expandedId === rec.id}
              onToggle={() => setExpandedId(value => value === rec.id ? null : rec.id)}
            />
            {expandedId === rec.id && <OwnerCommentSection videoId={rec.video_id} />}
          </div>
        ))}
      </div>

      {hasMore && !error && (
        <button
          type="button"
          onClick={() => loadHistory(history.length)}
          disabled={loading}
          className="owner-btn owner-btn--secondary owner-history__more"
        >
          {loading ? '불러오는 중…' : '이력 더 보기'}
        </button>
      )}
    </div>
  );
}
