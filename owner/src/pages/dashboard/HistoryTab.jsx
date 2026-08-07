import { useEffect, useState } from 'react';
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
  const [date, setDate] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  function loadHistory(offset = 0, targetDate = date) {
    setLoading(true);
    getHistory(offset, targetDate || null)
      .then(({ items, hasMore: nextHasMore }) => {
        setHistory(previous => offset === 0 ? items : [...previous, ...items]);
        setHasMore(nextHasMore);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (active && history.length === 0 && !loading) loadHistory(0);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDateChange(nextDate) {
    setDate(nextDate);
    setHistory([]);
    setExpandedId(null);
    loadHistory(0, nextDate || null);
  }

  if (!active) return null;

  return (
    <div>
      <div style={styles.historyFilter}>
        <input
          type="date"
          value={date}
          max={todayKstString()}
          onChange={event => handleDateChange(event.target.value)}
          style={styles.dateInput}
        />
        {date && (
          <button onClick={() => handleDateChange('')} style={styles.dateClearBtn}>전체 보기</button>
        )}
      </div>

      {loading && history.length === 0 && <div style={styles.empty}>불러오는 중...</div>}
      {!loading && history.length === 0 && <div style={styles.empty}>이력이 없습니다.</div>}

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

      {hasMore && (
        <button onClick={() => loadHistory(history.length)} disabled={loading} style={styles.moreBtn}>
          {loading ? '불러오는 중...' : '더 보기'}
        </button>
      )}
    </div>
  );
}
