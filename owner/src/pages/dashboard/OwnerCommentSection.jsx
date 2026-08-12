import { useState, useEffect } from 'react';
import { getSongComments } from '../../api';

export default function OwnerCommentSection({ videoId }) {
  const [comments, setComments] = useState(null);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setComments(null);
    setError('');
    getSongComments(videoId).then((page) => {
      if (!active) return;
      setComments(page.items);
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset ?? page.items.length);
    }).catch((caught) => {
      if (!active) return;
      setComments([]);
      setError(caught.message);
    });
    return () => { active = false; };
  }, [videoId]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const page = await getSongComments(videoId, nextOffset);
      setComments(previous => [...previous, ...page.items]);
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset ?? nextOffset + page.items.length);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoadingMore(false);
    }
  }

  if (comments === null) return <div style={commentStyles.wrap}><div style={commentStyles.loading}>댓글 불러오는 중...</div></div>;
  if (comments.length === 0) return <div style={commentStyles.wrap}><div style={commentStyles.empty}>{error || '댓글이 없습니다.'}</div></div>;

  return (
    <div style={commentStyles.wrap}>
      {comments.map(c => (
        <div key={c.id} style={commentStyles.item}>
          <div style={commentStyles.meta}>
            <span style={commentStyles.name}>{c.commenter_name || '익명'}</span>
            <span style={commentStyles.date}>{new Date(c.created_at).toLocaleDateString('ko-KR')}</span>
          </div>
          <div style={commentStyles.body}>{c.body}</div>
          {c.replies?.length > 0 && (
            <div style={commentStyles.replies}>
              {c.replies.map(r => (
                <div key={r.id} style={commentStyles.replyItem}>
                  <div style={commentStyles.meta}>
                    <span style={commentStyles.name}>{r.commenter_name || '익명'}</span>
                    <span style={commentStyles.date}>{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                  <div style={commentStyles.body}>{r.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {error && <div style={commentStyles.error}>{error}</div>}
      {hasMore && (
        <button type="button" style={commentStyles.more} onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? '불러오는 중...' : '댓글 더 보기'}
        </button>
      )}
    </div>
  );
}

const commentStyles = {
  wrap:      { padding: '12px 12px 16px 16px', background: '#fafafa', borderRadius: 8, marginBottom: 4 },
  loading:   { fontSize: 13, color: '#aaa', padding: '8px 0' },
  empty:     { fontSize: 13, color: '#aaa', padding: '8px 0' },
  item:      { marginTop: 12 },
  meta:      { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 },
  name:      { fontSize: 13, fontWeight: 700 },
  date:      { fontSize: 11, color: '#aaa' },
  body:      { fontSize: 13, lineHeight: 1.5 },
  replies:   { marginTop: 8, paddingLeft: 16, borderLeft: '2px solid #eee' },
  replyItem: { marginTop: 8 },
  error:     { marginTop: 10, fontSize: 12, color: '#dc2626' },
  more:      { width: '100%', marginTop: 12, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer' },
};
