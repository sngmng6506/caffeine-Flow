import { useEffect, useState } from 'react';
import { getDailyStats, getHourlyStats, getWeekdayStats, getWeekdaySongs, getHourlySongs, getStats, getSongComments } from '../api';

const STATUS_FILTER = {
  재생: r => r.status === 'played',
  스킵: r => r.status === 'skipped',
};

export default function StatsPanel() {
  const [today, setToday]         = useState(null);
  const [todayRecs, setTodayRecs] = useState([]);
  const [hourly, setHourly]       = useState(null);
  const [weekday, setWeekday]     = useState(null);
  const [topSongs, setTopSongs]   = useState(null);
  const [selected, setSelected]         = useState(null);
  const [selectedHour, setSelectedHour] = useState(null); // { index, recs, hasMore, loading }
  const [selectedWeekday, setSelectedWeekday] = useState(null); // { index, label, recs, hasMore, loading }
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey]   = useState(0);

  useEffect(() => {
    setLoadError(false);
    const date = new Date().toISOString().slice(0, 10);
    Promise.all([
      getDailyStats(date),
      getHourlyStats(),
      getWeekdayStats(),
      getStats(),
    ]).then(([t, h, w, st]) => {
      setTodayRecs(t.byHour.flat());
      setToday(t);
      setHourly(h);
      setWeekday(w);
      setTopSongs(st.topSongs || []);
    }).catch(err => {
      console.error(err);
      setLoadError(true);
    });
  }, [retryKey]);

  if (loadError) {
    return (
      <div style={s.loading}>
        통계를 불러오지 못했습니다.
        <button onClick={() => setRetryKey(k => k + 1)} style={s.retryBtn}>다시 시도</button>
      </div>
    );
  }
  if (!today || !hourly || !weekday || !topSongs) return <div style={s.loading}>불러오는 중...</div>;

  function handleCardClick(label) {
    setSelected(prev => prev === label ? null : label);
  }

  const filteredRecs = selected ? todayRecs.filter(STATUS_FILTER[selected]) : [];

  return (
    <div style={s.wrap}>
      {/* ── 오늘 요약 ── */}
      <Section title="오늘 요약">
        <div style={s.summaryGrid}>
          {[
            { label: '재생', value: today.played,  color: '#2196f3' },
            { label: '스킵', value: today.skipped, color: '#2196f3' },
          ].map(({ label, value, color }) => (
            <SummaryCard
              key={label}
              label={label}
              value={value}
              color={color}
              active={selected === label}
              onClick={() => handleCardClick(label)}
            />
          ))}
        </div>

        {selected && (
          <SongList recs={filteredRecs} label={`오늘 ${selected}`} />
        )}
      </Section>

      {/* ── 시간대별 추천 패턴 ── */}
      <Section title="시간대별 추천 패턴" sub="최근 30일 기준">
        <BarChart
          data={hourly}
          labelKey="hour"
          valueKey="count"
          formatLabel={h => `${h}시`}
          color="#2196f3"
          showEvery={3}
          selectedIndex={selectedHour?.index ?? null}
          onBarClick={i => {
            if (selectedHour?.index === i) { setSelectedHour(null); return; }
            setSelectedHour({ index: i, recs: [], hasMore: false, loading: true });
            getHourlySongs(i)
              .then(({ items, hasMore }) => setSelectedHour({ index: i, recs: items, hasMore, loading: false }))
              .catch(() => setSelectedHour({ index: i, recs: [], hasMore: false, loading: false }));
          }}
        />
        {selectedHour && (
          selectedHour.loading
            ? <div style={s.listEmpty}>불러오는 중...</div>
            : <SongList
                recs={selectedHour.recs}
                label={`최근 30일간 ${selectedHour.index}시`}
                hasMore={selectedHour.hasMore}
                onMore={() => {
                  const offset = selectedHour.recs.length;
                  getHourlySongs(selectedHour.index, offset)
                    .then(({ items, hasMore }) => setSelectedHour(prev => ({ ...prev, recs: [...prev.recs, ...items], hasMore })))
                    .catch(() => {});
                }}
              />
        )}
      </Section>

      {/* ── 요일별 추천 패턴 ── */}
      <Section title="요일별 추천 패턴" sub="최근 30일 기준">
        <BarChart
          data={weekday}
          labelKey="day"
          valueKey="count"
          formatLabel={d => d}
          color="#2196f3"
          showEvery={1}
          selectedIndex={selectedWeekday?.index ?? null}
          onBarClick={i => {
            if (selectedWeekday?.index === i) { setSelectedWeekday(null); return; }
            const label = ['일', '월', '화', '수', '목', '금', '토'][i];
            setSelectedWeekday({ index: i, label, recs: [], hasMore: false, loading: true });
            getWeekdaySongs(i)
              .then(({ items, hasMore }) => setSelectedWeekday({ index: i, label, recs: items, hasMore, loading: false }))
              .catch(() => setSelectedWeekday({ index: i, label, recs: [], hasMore: false, loading: false }));
          }}
        />
        {selectedWeekday && (
          selectedWeekday.loading
            ? <div style={s.listEmpty}>불러오는 중...</div>
            : <SongList
                recs={selectedWeekday.recs}
                label={`최근 30일간 ${selectedWeekday.label}요일`}
                hasMore={selectedWeekday.hasMore}
                onMore={() => {
                  const offset = selectedWeekday.recs.length;
                  getWeekdaySongs(selectedWeekday.index, offset)
                    .then(({ items, hasMore }) => setSelectedWeekday(prev => ({ ...prev, recs: [...prev.recs, ...items], hasMore })))
                    .catch(() => {});
                }}
              />
        )}
      </Section>

      {/* ── 인기곡 TOP 10 ── */}
      <Section title="인기곡 TOP 10" sub="누적 재생 기준">
        {topSongs.length === 0
          ? <div style={s.listEmpty}>아직 재생된 곡이 없습니다.</div>
          : <TopSongsList songs={topSongs} />
        }
      </Section>
    </div>
  );
}

function SongList({ recs, label, hasMore, onMore }) {
  const [expanded, setExpanded] = useState(null);

  if (recs.length === 0) return <div style={s.listEmpty}>{label} 추천된 곡이 없습니다.</div>;

  return (
    <div style={s.songList}>
      {recs.map((r, i) => (
        <div key={r.id || `${r.video_id}-${i}`}>
          <div
            style={{ ...s.songItem, cursor: 'pointer' }}
            onClick={() => setExpanded(v => v === r.video_id ? null : r.video_id)}
          >
            <span style={s.songIdx}>{i + 1}</span>
            <img src={r.thumbnail} alt="" style={s.songThumb} />
            <div style={s.songInfo}>
              <div style={s.songTitle}>{r.title}</div>
              <div style={s.songMeta}>{r.channel_title}</div>
            </div>
            {r.count > 1 && <span style={s.songCount}>{r.count}건</span>}
            <span style={s.chevron}>{expanded === r.video_id ? '▲' : '▼'}</span>
          </div>
          {expanded === r.video_id && (
            <CommentSection videoId={r.video_id} />
          )}
        </div>
      ))}
      {hasMore && (
        <button onClick={onMore} style={s.moreBtn}>더보기</button>
      )}
    </div>
  );
}

function Section({ title, sub, children }) {
  return (
    <div style={s.section}>
      <div style={s.sectionHeader}>
        <span style={s.sectionTitle}>{title}</span>
        {sub && <span style={s.sectionSub}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function SummaryCard({ label, value, color, active, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ ...s.summaryCard, ...(active ? { ...s.summaryCardActive, borderColor: '#2196f3' } : {}) }}
    >
      <div style={{ ...s.summaryValue, color }}>{value}</div>
      <div style={s.summaryLabel}>{label} {active ? '▲' : '▼'}</div>
    </div>
  );
}

function BarChart({ data, labelKey, valueKey, formatLabel, color, showEvery, selectedIndex, onBarClick }) {
  const max = Math.max(...data.map(d => d[valueKey]), 1);
  const clickable = !!onBarClick;
  return (
    <div style={s.chartWrap}>
      <div style={s.bars}>
        {data.map((d, i) => {
          const isSelected = selectedIndex === i;
          return (
            <div
              key={i}
              style={{ ...s.barCol, cursor: clickable ? 'pointer' : 'default' }}
              onClick={() => onBarClick?.(i)}
            >
              <div style={s.barValueWrap}>
                {d[valueKey] > 0 && <div style={s.barValue}>{d[valueKey]}</div>}
                <div style={{
                  ...s.bar,
                  height: `${Math.round((d[valueKey] / max) * 100)}%`,
                  background: isSelected ? '#1a1a2e' : color,
                  opacity: selectedIndex !== null && !isSelected ? 0.35 : 1,
                }} />
              </div>
              <div style={{ ...s.barLabel, fontWeight: isSelected ? 700 : 400, color: isSelected ? '#1a1a2e' : '#888' }}>
                {i % showEvery === 0 ? formatLabel(d[labelKey]) : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopSongsList({ songs }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <div style={s.songList}>
      {songs.map((song, i) => (
        <div key={song.video_id}>
          <div
            style={{ ...s.songItem, cursor: 'pointer' }}
            onClick={() => setExpanded(v => v === song.video_id ? null : song.video_id)}
          >
            <span style={s.songIdx}>{i + 1}</span>
            <img src={song.thumbnail} alt="" style={s.songThumb} />
            <div style={s.songInfo}>
              <div style={s.songTitle}>{song.title}</div>
              <div style={s.songMeta}>{song.channel_title} · {song.count}회</div>
            </div>
            <span style={s.chevron}>{expanded === song.video_id ? '▲' : '▼'}</span>
          </div>
          {expanded === song.video_id && (
            <CommentSection videoId={song.video_id} />
          )}
        </div>
      ))}
    </div>
  );
}

function CommentSection({ videoId }) {
  const [comments, setComments] = useState(null);

  useEffect(() => {
    getSongComments(videoId).then(setComments).catch(() => setComments([]));
  }, [videoId]);

  if (comments === null) return <div style={s.commentWrap}><div style={s.commentEmpty}>댓글 불러오는 중...</div></div>;
  if (comments.length === 0) return <div style={s.commentWrap}><div style={s.commentEmpty}>댓글이 없습니다.</div></div>;

  return (
    <div style={s.commentWrap}>
      {comments.map(c => (
        <div key={c.id} style={s.commentItem}>
          <div style={s.commentMeta}>
            <span style={s.commentName}>{c.commenter_name || '익명'}</span>
            <span style={s.commentDate}>{new Date(c.created_at).toLocaleDateString('ko-KR')}</span>
          </div>
          <div style={s.commentBody}>{c.body}</div>
          {c.replies?.length > 0 && (
            <div style={s.commentReplies}>
              {c.replies.map(r => (
                <div key={r.id} style={s.commentReplyItem}>
                  <div style={s.commentMeta}>
                    <span style={s.commentName}>{r.commenter_name || '익명'}</span>
                    <span style={s.commentDate}>{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                  <div style={s.commentBody}>{r.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const s = {
  wrap:            { padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 24 },
  loading:         { color: '#888', fontSize: 13, padding: '40px 0', textAlign: 'center' },
  retryBtn:        { marginLeft: 8, padding: '4px 12px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', color: '#555', cursor: 'pointer', fontSize: 12 },
  section:         { display: 'flex', flexDirection: 'column', gap: 12 },
  sectionHeader:   { display: 'flex', alignItems: 'baseline', gap: 8 },
  sectionTitle:    { fontSize: 15, fontWeight: 700 },
  sectionSub:      { fontSize: 12, color: '#aaa' },

  summaryGrid:     { display: 'flex', gap: 10 },
  summaryCard:     { flex: 1, background: '#f8f8f8', borderRadius: 10, padding: '16px 8px', textAlign: 'center', cursor: 'pointer', border: '2px solid transparent', transition: 'border-color 0.15s' },
  summaryCardActive: { background: '#fff', border: '2px solid' },
  summaryValue:    { fontSize: 28, fontWeight: 800 },
  summaryLabel:    { fontSize: 12, color: '#888', marginTop: 4 },

  songList:        { marginTop: 8, borderRadius: 10, border: '1px solid #eee', overflow: 'hidden' },
  songItem:        { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid #f0f0f0' },
  songIdx:         { width: 20, fontSize: 12, color: '#aaa', textAlign: 'center', flexShrink: 0 },
  songThumb:       { width: 48, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 },
  songInfo:        { flex: 1, minWidth: 0 },
  songTitle:       { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  songMeta:        { fontSize: 11, color: '#aaa', marginTop: 2 },
  songCount:       { fontSize: 12, fontWeight: 700, color: '#2196f3', flexShrink: 0, marginLeft: 'auto', paddingLeft: 8 },
  listEmpty:       { fontSize: 13, color: '#aaa', padding: '16px', textAlign: 'center', background: '#f8f8f8', borderRadius: 10 },
  moreBtn:         { width: '100%', padding: '10px', background: '#f8f8f8', border: 'none', borderTop: '1px solid #eee', cursor: 'pointer', fontSize: 13, color: '#888' },

  chartWrap:       { background: '#f8f8f8', borderRadius: 10, padding: '16px 12px' },
  bars:            { display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 },
  barCol:          { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%' },
  barValueWrap:    { flex: 1, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' },
  bar:             { width: '100%', borderRadius: '3px 3px 0 0', minHeight: 2 },
  barValue:        { fontSize: 9, color: '#888', marginBottom: 2 },
  barLabel:        { fontSize: 10, color: '#888', height: 16 },

  chevron:         { fontSize: 11, color: '#aaa', flexShrink: 0 },
  commentWrap:     { padding: '12px 12px 16px 16px', background: '#fafafa', borderRadius: 8, marginBottom: 4, borderTop: '1px solid #eee' },
  commentEmpty:    { fontSize: 13, color: '#aaa', padding: '8px 0' },
  commentItem:     { marginTop: 12 },
  commentMeta:     { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 },
  commentName:     { fontSize: 13, fontWeight: 700 },
  commentDate:     { fontSize: 11, color: '#aaa' },
  commentBody:     { fontSize: 13, lineHeight: 1.5 },
  commentReplies:  { marginTop: 8, paddingLeft: 16, borderLeft: '2px solid #eee' },
  commentReplyItem:{ marginTop: 8 },
};
