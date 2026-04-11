import { useEffect, useState } from 'react';
import { getRecommendations, getCafeTop10, getGlobalTop10, getSongComments, postSongComment, postSongReply } from '../api';
import { getDeviceName } from '../deviceName';
import { getSocket, disconnectSocket } from '../socket';
import NowPlaying from './NowPlaying';
import RecommendForm from './RecommendForm';
import SongCard from './SongCard';

function getTabs(cafeName) {
  return [
    { id: 'queue',     label: '추천곡' },
    { id: 'history',  label: '최근 7일 이력' },
    { id: 'cafeTop',  label: cafeName ? `${cafeName} TOP` : '카페 TOP' },
    { id: 'globalTop', label: '전체 TOP' },
  ];
}

export default function CafePage({ slug }) {
  const [recs, setRecs] = useState([]);
  const [isAccepting, setIsAccepting] = useState(true);
  const [notice, setNotice] = useState(null);
  const [cafeName, setCafeName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('queue');
  const [cafeTop, setCafeTop]       = useState([]);
  const [cafeTopHasMore, setCafeTopHasMore] = useState(false);
  const [globalTop, setGlobalTop]   = useState([]);
  const [globalTopHasMore, setGlobalTopHasMore] = useState(false);
  const [topLoading, setTopLoading] = useState(false);
  const [topLoaded, setTopLoaded]   = useState({ cafeTop: false, globalTop: false });
  const [successMsg, setSuccessMsg]     = useState('');
  const [successTimer, setSuccessTimer] = useState(null);
  const [historyLimit, setHistoryLimit] = useState(10);
  const deviceName = getDeviceName();

  const nowPlaying = recs.find(r => r.status === 'playing') || null;
  const queue = recs
    .filter(r => r.status === 'pending' || r.status === 'accepted')
    .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at));
  const history = recs.filter(r => r.status === 'played' || r.status === 'skipped' || r.status === 'rejected');

  useEffect(() => {
    getRecommendations(slug)
      .then(({ recommendations, is_accepting, notice, cafe_name }) => {
        setRecs(recommendations);
        setIsAccepting(is_accepting);
        setNotice(notice);
        setCafeName(cafe_name);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    const socket = getSocket(slug);

    let connected = false;
    socket.on('connect', () => {
      if (!connected) { connected = true; return; }
      // 재연결 시 놓친 업데이트 복구
      getRecommendations(slug)
        .then(({ recommendations, is_accepting, notice, cafe_name }) => {
          setRecs(recommendations);
          setIsAccepting(is_accepting);
          setNotice(notice);
          setCafeName(cafe_name);
        })
        .catch(() => {});
    });

    socket.on('recommendations_update', ({ action, rec, id }) => {
      if (action === 'add')    setRecs(prev => prev.some(r => r.id === rec.id) ? prev : [rec, ...prev]);
      if (action === 'update' || action === 'vote') setRecs(prev => prev.map(r => r.id === rec.id ? rec : r));
      if (action === 'delete') setRecs(prev => prev.filter(r => r.id !== id));
    });

    socket.on('system_toggled', ({ is_accepting }) => setIsAccepting(is_accepting));
    socket.on('notice_updated', ({ notice }) => setNotice(notice));
    socket.on('cafe_updated',   ({ cafe_name }) => setCafeName(cafe_name));

    return () => disconnectSocket();
  }, [slug]);

  useEffect(() => {
    if (tab === 'cafeTop' && !topLoaded.cafeTop) {
      setTopLoading(true);
      getCafeTop10(slug, 0)
        .then(({ items, hasMore }) => { setCafeTop(items); setCafeTopHasMore(hasMore); setTopLoaded(p => ({ ...p, cafeTop: true })); })
        .catch(() => {})
        .finally(() => setTopLoading(false));
    }
    if (tab === 'globalTop' && !topLoaded.globalTop) {
      setTopLoading(true);
      getGlobalTop10(0)
        .then(({ items, hasMore }) => { setGlobalTop(items); setGlobalTopHasMore(hasMore); setTopLoaded(p => ({ ...p, globalTop: true })); })
        .catch(() => {})
        .finally(() => setTopLoading(false));
    }
  }, [tab]);

  async function loadMoreTop() {
    setTopLoading(true);
    try {
      if (tab === 'cafeTop') {
        const { items, hasMore } = await getCafeTop10(slug, cafeTop.length);
        setCafeTop(prev => [...prev, ...items]);
        setCafeTopHasMore(hasMore);
      } else {
        const { items, hasMore } = await getGlobalTop10(globalTop.length);
        setGlobalTop(prev => [...prev, ...items]);
        setGlobalTopHasMore(hasMore);
      }
    } catch {}
    setTopLoading(false);
  }

  function handleUpdate(updated) {
    setRecs(prev => prev.map(r => r.id === updated.id ? updated : r));
  }

  function handleDelete(id) {
    setRecs(prev => prev.filter(r => r.id !== id));
  }

  function handleAdded(rec) {
    setRecs(prev => prev.some(r => r.id === rec.id) ? prev : [rec, ...prev]);
    const position = recs.filter(r => r.status === 'pending' || r.status === 'accepted').length + 1;
    setSuccessMsg(`${position}번째로 대기 중이에요!`);
    if (successTimer) clearTimeout(successTimer);
    setSuccessTimer(setTimeout(() => setSuccessMsg(''), 4000));
  }

  if (loading) return <div style={styles.center}>불러오는 중...</div>;
  if (error)   return <div style={styles.center}>{error}</div>;

  return (
    <div style={styles.page}>
      {cafeName && <h2 style={styles.cafeName}>{cafeName}</h2>}
      {notice && <div style={styles.notice}>📢 {notice}</div>}
      {!isAccepting && <div style={styles.closed}>현재 추천을 받지 않습니다</div>}

      <NowPlaying rec={nowPlaying} />

      {isAccepting && tab === 'queue' && (
        <RecommendForm
          slug={slug}
          onAdded={handleAdded}
          activeVideoIds={recs
            .filter(r => ['pending', 'accepted', 'playing'].includes(r.status))
            .map(r => r.video_id)}
        />
      )}
      {successMsg && <div style={styles.successMsg}>{successMsg}</div>}

      <div style={styles.tabBar}>
        {getTabs(cafeName).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{ ...styles.tabBtn, ...(tab === t.id ? styles.tabActive : {}) }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'queue' && (
        <>
          {queue.length > 0 && (
            <section>
              <h3 style={styles.sectionTitle}>대기 중 ({queue.length})</h3>
              {queue.map((r, i) => (
                <SongCard key={r.id} slug={slug} rec={r} onUpdate={handleUpdate} onDelete={handleDelete} position={i + 1}
                  isMyRequest={r.requester_name === deviceName} />
              ))}
            </section>
          )}
          {queue.length === 0 && (
            <div style={styles.empty}>대기 중인 추천곡이 없습니다.<br />첫 번째 곡을 추천해보세요!</div>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          {history.length === 0 && (
            <div style={styles.empty}>최근 7일 재생 이력이 없습니다.</div>
          )}
          {history.length > 0 && (
            <section>
              {history.slice(0, historyLimit).map(r => (
                <SongCard key={r.id} slug={slug} rec={r} onUpdate={handleUpdate} showDate />
              ))}
              {historyLimit < history.length && (
                <button onClick={() => setHistoryLimit(p => p + 10)} style={styles.loadMoreBtn}>
                  더 보기 ({history.length - historyLimit}개 남음)
                </button>
              )}
            </section>
          )}
        </>
      )}

      {(tab === 'cafeTop' || tab === 'globalTop') && (
        <Top10List
          items={tab === 'cafeTop' ? cafeTop : globalTop}
          hasMore={tab === 'cafeTop' ? cafeTopHasMore : globalTopHasMore}
          loading={topLoading}
          slug={tab === 'cafeTop' ? slug : null}
          onLoadMore={loadMoreTop}
        />
      )}
      <footer style={styles.footer}>
        <span style={styles.footerLabel}>dev info</span>
        <span style={styles.footerLink}>github.com/sngmng6506</span>
      </footer>
    </div>
  );
}

function Top10List({ items, hasMore, loading, slug, onLoadMore }) {
  const [expanded, setExpanded] = useState(null);
  const [sortBy, setSortBy] = useState('count'); // 'count' | 'votes'

  if (loading && items.length === 0) return <div style={styles.center}>불러오는 중...</div>;
  if (!loading && items.length === 0) return <div style={styles.empty}>아직 데이터가 없습니다.</div>;

  const sorted = [...items].sort((a, b) => {
    if (sortBy === 'votes') {
      const diff = (b.total_votes || 0) - (a.total_votes || 0);
      return diff !== 0 ? diff : b.count - a.count;
    } else {
      const diff = b.count - a.count;
      return diff !== 0 ? diff : (b.total_votes || 0) - (a.total_votes || 0);
    }
  });

  return (
    <>
      <div style={styles.sortBar}>
        <button onClick={() => setSortBy('count')} style={{ ...styles.sortBtn, ...(sortBy === 'count' ? styles.sortActive : {}) }}>신청순</button>
        <button onClick={() => setSortBy('votes')} style={{ ...styles.sortBtn, ...(sortBy === 'votes' ? styles.sortActive : {}) }}>추천순</button>
      </div>
    <ol style={styles.rankList}>
      {sorted.map((item, i) => (
        <li key={item.video_id} style={styles.rankItem}>
          <div
            style={styles.rankRow}
            onClick={() => setExpanded(v => v === item.video_id ? null : item.video_id)}
          >
            <span style={styles.rank}>{i + 1}</span>
            <img src={item.thumbnail} alt="" style={styles.thumb} />
            <div style={styles.rankInfo}>
              <div style={styles.rankTitle}>{item.title}</div>
              <div style={styles.rankMeta}>{item.channel_title} · {item.count}회 신청 · 👍 {item.total_votes || 0}</div>
            </div>
            <span style={styles.chevron}>{expanded === item.video_id ? '▲' : '▼'}</span>
          </div>
          {expanded === item.video_id && (
            <CommentSection videoId={item.video_id} slug={slug} isGlobal={!slug} />
          )}
        </li>
      ))}
    </ol>
    {hasMore && (
      <button onClick={onLoadMore} disabled={loading} style={styles.loadMoreBtn}>
        {loading ? '불러오는 중...' : '더 보기'}
      </button>
    )}
    </>
  );
}

function CommentSection({ videoId, slug, isGlobal }) {
  const [comments, setComments] = useState(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const deviceName = getDeviceName();

  useEffect(() => {
    getSongComments(videoId).then(setComments).catch(() => setComments([]));
  }, [videoId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError('');
    try {
      const comment = await postSongComment(videoId, slug, {
        commenterName: deviceName,
        body: body.trim(),
      });
      setComments(prev => [comment, ...prev]);
      setBody('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.commentSection}>
      <div style={styles.deviceName}>내 닉네임: <strong>{deviceName}</strong></div>
      <form onSubmit={handleSubmit} style={styles.commentForm}>
        <div style={styles.commentInputRow}>
          <input
            placeholder="댓글 추가..."
            value={body}
            onChange={e => setBody(e.target.value)}
            style={styles.bodyInput}
            maxLength={200}
            required
          />
        </div>
        {error && <div style={styles.commentError}>{error}</div>}
        {body.trim() && (
          <div style={styles.commentActions}>
            <button type="button" onClick={() => setBody('')} style={styles.cancelBtn}>취소</button>
            <button type="submit" disabled={loading} style={styles.submitBtn}>
              {loading ? '등록 중...' : '댓글'}
            </button>
          </div>
        )}
      </form>

      {comments === null && <div style={styles.commentLoading}>불러오는 중...</div>}
      {comments?.length === 0 && <div style={styles.noComment}>첫 번째 댓글을 남겨보세요.</div>}
      {comments?.map(c => (
        <CommentItem key={c.id} comment={c} videoId={videoId} slug={slug} deviceName={deviceName} isGlobal={isGlobal}
          onReplyAdded={(reply) => setComments(prev =>
            prev.map(x => x.id === c.id ? { ...x, replies: [...x.replies, reply] } : x)
          )}
        />
      ))}
    </div>
  );
}

function CommentItem({ comment: c, videoId, slug, deviceName, isGlobal, onReplyAdded }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleReply(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError('');
    try {
      const reply = await postSongReply(videoId, c.id, slug, {
        commenterName: deviceName,
        body: body.trim(),
      });
      onReplyAdded(reply);
      setBody('');
      setReplyOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.commentItem}>
      <div style={styles.commentMeta}>
        <span style={styles.commenterName}>
          {c.commenter_name || '익명'}{isGlobal && c.cafe_name ? <span style={styles.cafeTag}> in {c.cafe_name}</span> : ''}
        </span>
        <span style={styles.commentDate}>{new Date(c.created_at).toLocaleDateString('ko-KR')}</span>
      </div>
      <div style={styles.commentBody}>{c.body}</div>
      <button onClick={() => setReplyOpen(v => !v)} style={styles.replyBtn}>답글</button>

      {(c.replies?.length > 0 || replyOpen) && (
        <div style={styles.replies}>
          {c.replies?.map(r => (
            <div key={r.id} style={styles.replyItem}>
              <div style={styles.commentMeta}>
                <span style={styles.commenterName}>
                  {r.commenter_name || '익명'}{isGlobal && r.cafe_name ? <span style={styles.cafeName}> in {r.cafe_name}</span> : ''}
                </span>
                <span style={styles.commentDate}>{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
              </div>
              <div style={styles.commentBody}>{r.body}</div>
              <button onClick={() => setReplyOpen(true)} style={styles.replyBtn}>답글</button>
            </div>
          ))}

          {replyOpen && (
            <form onSubmit={handleReply} style={styles.replyForm}>
              <input
                placeholder="답글 추가..."
                value={body}
                onChange={e => setBody(e.target.value)}
                style={styles.bodyInput}
                maxLength={200}
                required
                autoFocus
              />
              {error && <div style={styles.commentError}>{error}</div>}
              <div style={styles.commentActions}>
                <button type="button" onClick={() => { setReplyOpen(false); setBody(''); }} style={styles.cancelBtn}>취소</button>
                <button type="submit" disabled={loading} style={styles.submitBtn}>{loading ? '등록 중...' : '답글'}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  page:        { maxWidth: 480, margin: '0 auto', padding: '16px', fontFamily: 'sans-serif' },
  cafeName:    { margin: '0 0 12px 0', fontSize: 24, fontWeight: 800, color: '#1a1a2e' },
  notice:      { marginBottom: 12, padding: '10px 14px', background: '#e3f2fd', borderRadius: 8, fontSize: 13, color: '#1565c0' },
  closed:      { marginBottom: 16, padding: '8px 12px', background: '#fff3cd', borderRadius: 8, fontSize: 13, color: '#856404' },
  successMsg:  { marginBottom: 12, padding: '10px 14px', background: '#e8f5e9', borderRadius: 8, fontSize: 13, color: '#2e7d32', fontWeight: 600 },
  tabBar:      { display: 'flex', gap: 4, margin: '16px 0', borderBottom: '1px solid #eee', paddingBottom: 0 },
  tabBtn:      { flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 600, border: 'none', borderBottom: '2px solid transparent', background: 'none', cursor: 'pointer', color: '#aaa' },
  tabActive:   { color: '#1a1a2e', borderBottom: '2px solid #1a1a2e' },
  sectionTitle:{ fontSize: 15, fontWeight: 700, margin: '0 0 8px 0', color: '#333' },
  empty:       { textAlign: 'center', color: '#aaa', padding: '40px 0', lineHeight: 1.8 },
  center:      { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'sans-serif' },
  loadMoreBtn:    { width: '100%', marginTop: 12, padding: '10px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#555' },
  sortBar:        { display: 'flex', gap: 6, marginBottom: 12 },
  sortBtn:        { padding: '5px 14px', borderRadius: 18, border: '1px solid #ddd', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#888' },
  sortActive:     { background: '#1a1a2e', color: '#fff', border: '1px solid #1a1a2e', fontWeight: 600 },
  rankList:       { listStyle: 'none', margin: 0, padding: 0 },
  rankItem:       { borderBottom: '1px solid #eee' },
  rankRow:        { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', cursor: 'pointer' },
  rank:           { width: 24, textAlign: 'center', fontWeight: 800, fontSize: 15, color: '#1a1a2e', flexShrink: 0 },
  thumb:          { width: 60, height: 45, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  rankInfo:       { flex: 1, minWidth: 0 },
  rankTitle:      { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rankMeta:       { fontSize: 12, color: '#888', marginTop: 2 },
  chevron:        { fontSize: 11, color: '#aaa', flexShrink: 0 },

  commentSection: { padding: '12px 0 16px 36px', background: '#fafafa', borderRadius: 8, marginBottom: 4 },
  commentForm:    { marginBottom: 12 },
  commentInputRow:{ display: 'flex', gap: 10, alignItems: 'flex-start' },
  deviceName:     { fontSize: 12, color: '#888', marginBottom: 8 },
  bodyInput:      { flex: 1, fontSize: 13, padding: '6px 8px', borderRadius: 6, border: 'none', borderBottom: '1px solid #ccc', outline: 'none', background: 'transparent' },
  commentActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  cancelBtn:      { padding: '6px 12px', borderRadius: 18, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#555' },
  submitBtn:      { padding: '6px 14px', borderRadius: 18, border: 'none', background: '#1a1a2e', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  commentError:   { fontSize: 12, color: '#e63946', marginTop: 4 },
  commentLoading: { fontSize: 13, color: '#aaa', padding: '8px 0' },
  noComment:      { fontSize: 13, color: '#aaa', padding: '8px 0' },
  commentItem:    { marginTop: 12 },
  commentMeta:    { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 },
  commenterName:  { fontSize: 13, fontWeight: 700 },
  cafeTag:        { fontSize: 12, fontWeight: 400, color: '#bbb' },
  commentDate:    { fontSize: 11, color: '#aaa' },
  commentBody:    { fontSize: 13, lineHeight: 1.5 },
  replyBtn:       { fontSize: 12, fontWeight: 600, color: '#555', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginTop: 2 },
  replyForm:      { marginTop: 8 },
  replies:        { marginTop: 8, paddingLeft: 16, borderLeft: '2px solid #eee' },
  footer:         { marginTop: 40, paddingBottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  footerLabel:    { fontSize: 10, color: '#ddd', fontFamily: 'monospace' },
  footerLink:     { fontSize: 11, color: '#ccc', fontFamily: 'monospace' },
  replyItem:      { marginTop: 8 },
};
