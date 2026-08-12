import { useEffect, useState } from 'react';
import { MessageCircle, Reply, Send } from 'lucide-react';
import { getSongComments, postSongComment, postSongReply } from '../api';
import { getDeviceName } from '../deviceName';

const PAGE_SIZE = 20;

export default function CafeComments({ videoId, slug }) {
  const [comments, setComments] = useState(null);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState('');
  const deviceName = getDeviceName();

  useEffect(() => {
    let active = true;
    setComments(null);
    setError('');
    getSongComments(videoId, 0, PAGE_SIZE)
      .then((page) => {
        if (!active) return;
        setComments(page.items);
        setHasMore(page.hasMore);
        setNextOffset(page.nextOffset ?? page.items.length);
      })
      .catch((caught) => {
        if (!active) return;
        setComments([]);
        setError(caught.message);
      });
    return () => { active = false; };
  }, [videoId]);

  async function handleLoadMore() {
    if (pageLoading || !hasMore) return;
    setPageLoading(true);
    setError('');
    try {
      const page = await getSongComments(videoId, nextOffset, PAGE_SIZE);
      setComments(previous => [...(previous || []), ...page.items]);
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset ?? nextOffset + page.items.length);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setPageLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const comment = await postSongComment(videoId, slug, { commenterName: deviceName, body: body.trim() });
      setComments(previous => [comment, ...(previous || [])]);
      setBody('');
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className='comments' aria-label='댓글'>
      <div className='comments__heading'>
        <span><MessageCircle size={17} aria-hidden='true' /> 댓글</span>
        <small>내 닉네임 · {deviceName}</small>
      </div>
      <form className='comment-form' onSubmit={handleSubmit}>
        <label className='sr-only' htmlFor={`comment-${videoId}`}>댓글</label>
        <input id={`comment-${videoId}`} value={body} onChange={event => setBody(event.target.value)} placeholder='댓글을 남겨 보세요' maxLength={200} required />
        {body.trim() && (
          <div className='comment-form__actions'>
            <button type='button' className='button button--text' onClick={() => setBody('')}>돌아가기</button>
            <button type='submit' className='button button--primary button--compact' disabled={submitting}>
              <Send size={15} aria-hidden='true' /> {submitting ? '등록 중...' : '댓글 등록하기'}
            </button>
          </div>
        )}
      </form>

      {error && <p className='form-error' role='alert'>{error}</p>}
      {comments === null && <p className='comments__state'>댓글을 불러오고 있어요.</p>}
      {comments?.length === 0 && !error && <p className='comments__state'>아직 댓글이 없어요.<br />첫 번째 이야기를 남겨 보세요.</p>}
      {comments?.map(comment => (
        <CommentItem
          key={comment.id}
          comment={comment}
          videoId={videoId}
          slug={slug}
          deviceName={deviceName}
          onReplyAdded={reply => setComments(previous => previous.map(item => (
            item.id === comment.id
              ? { ...item, replies: [...(item.replies || []), reply] }
              : item
          )))}
        />
      ))}
      {hasMore && (
        <button type='button' className='button button--secondary button--full' onClick={handleLoadMore} disabled={pageLoading}>
          {pageLoading ? '댓글 불러오는 중...' : '댓글 더 보기'}
        </button>
      )}
    </section>
  );
}

function CommentItem({ comment, videoId, slug, deviceName, onReplyAdded }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleReply(event) {
    event.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError('');
    try {
      const reply = await postSongReply(videoId, comment.id, slug, { commenterName: deviceName, body: body.trim() });
      onReplyAdded(reply);
      setBody('');
      setReplyOpen(false);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className='comment-item'>
      <div className='comment-item__meta'>
        <strong>{comment.commenter_name || '익명'}{comment.cafe_name && <small> · {comment.cafe_name}</small>}</strong>
        <time>{new Date(comment.created_at).toLocaleDateString('ko-KR')}</time>
      </div>
      <p>{comment.body}</p>
      <button type='button' className='reply-button' aria-expanded={replyOpen} onClick={() => setReplyOpen(value => !value)}><Reply size={14} aria-hidden='true' /> 답글</button>

      {(comment.replies?.length > 0 || replyOpen) && (
        <div className='replies'>
          {comment.replies?.map(reply => (
            <article className='reply-item' key={reply.id}>
              <div className='comment-item__meta'>
                <strong>{reply.commenter_name || '익명'}{reply.cafe_name && <small> · {reply.cafe_name}</small>}</strong>
                <time>{new Date(reply.created_at).toLocaleDateString('ko-KR')}</time>
              </div>
              <p>{reply.body}</p>
              <button type='button' className='reply-button' onClick={() => setReplyOpen(true)}><Reply size={14} aria-hidden='true' /> 답글</button>
            </article>
          ))}

          {replyOpen && (
            <form className='reply-form' onSubmit={handleReply}>
              <label className='sr-only' htmlFor={`reply-${comment.id}`}>답글</label>
              <input id={`reply-${comment.id}`} value={body} onChange={event => setBody(event.target.value)} placeholder='답글을 남겨 보세요' maxLength={200} required autoFocus />
              {error && <p className='form-error' role='alert'>{error}</p>}
              <div className='comment-form__actions'>
                <button type='button' className='button button--text' onClick={() => { setReplyOpen(false); setBody(''); }}>돌아가기</button>
                <button type='submit' className='button button--primary button--compact' disabled={loading}>{loading ? '등록 중...' : '답글 등록하기'}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </article>
  );
}
