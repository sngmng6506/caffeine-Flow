import { useEffect, useRef, useState } from 'react';
import { getHistory } from '../../api';
import RecommendCard from '../RecommendCard';
import OwnerCommentSection from './OwnerCommentSection';
import { dashboardStyles as styles } from './dashboardStyles';

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
        setError(fetchError.message || '이력을 불러오지 못했습니다.');
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
    <div>
      <div style={styles.historyFilter}>
        <div style={styles.historyQuickFilters}>
          <button
            onClick={() => handleDateChange('')}
            aria-pressed={!date}
            style={{ ...styles.historyQuickBtn, ...(!date ? styles.historyQuickBtnActive : {}) }}
          >전체</button>
          <button
            onClick={() => handleDateChange(today)}
            aria-pressed={date === today}
            style={{ ...styles.historyQuickBtn, ...(date === today ? styles.historyQuickBtnActive : {}) }}
          >오늘</button>
        </div>
        <input
          type="date"
          value={date}
          max={today}
          aria-label="이력 날짜 선택"
          onChange={event => handleDateChange(event.target.value)}
          style={styles.dateInput}
        />
      </div>

      {loading && history.length === 0 && <div style={styles.empty}>불러오는 중...</div>}
      {!loading && !error && history.length === 0 && <div style={styles.empty}>이력이 없습니다.</div>}

      {error && (
        <div role="alert" style={styles.historyError}>
          <span>{error}</span>
          <button
            onClick={() => loadHistory(history.length > 0 ? history.length : 0, date)}
            disabled={loading}
            style={styles.historyRetryBtn}
          >다시 불러오기</button>
        </div>
      )}

      {history.map(rec => (
        <div key={rec.id}>
          <div
            onClick={() => setExpandedId(value => value === rec.id ? null : rec.id)}
            style={{ cursor: 'pointer' }}
          >
            <RecommendCard
              slug={slug}
              rec={rec}
              onUpdate={onUpdate}
              onDelete={onDelete}
              expanded={expandedId === rec.id}
            />
          </div>
          {expandedId === rec.id && <OwnerCommentSection videoId={rec.video_id} />}
        </div>
      ))}

      {hasMore && !error && (
        <button onClick={() => loadHistory(history.length)} disabled={loading} style={styles.moreBtn}>
          {loading ? '불러오는 중...' : '더 보기'}
        </button>
      )}
    </div>
  );
}
