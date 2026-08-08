import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Heart,
  Info,
  LoaderCircle,
  MessageCircle,
  Music2,
  PauseCircle,
  Reply,
  Send,
} from 'lucide-react';
import {
  getRecommendations,
  getCafeTop10,
  getGlobalTop10,
  getSongComments,
  postSongComment,
  postSongReply,
} from '../api';
import { getDeviceName } from '../deviceName';
import { getSocket, disconnectSocket } from '../socket';
import { VALID_PLATFORMS } from '../constants/platforms';
import { ACTIVE_STATUSES, HISTORY_STATUSES, REC_STATUS } from '../constants/recommendationStatus';
import { PLAYBACK_STATE } from '../constants/playbackState';
import NowPlaying from './NowPlaying';
import RecommendForm from './RecommendForm';
import SongCard from './SongCard';
import SongThumbnail from '../components/SongThumbnail';

function getTabs(cafeName) {
  return [
    { id: 'queue', label: '신청곡' },
    { id: 'history', label: '최근 재생' },
    { id: 'cafeTop', label: cafeName ? `${cafeName} TOP` : '매장 TOP' },
    { id: 'globalTop', label: '전체 TOP' },
  ];
}

function StatePanel({ icon: Icon = Music2, title, description, loading = false }) {
  return (
    <div className='empty-state' role={loading ? 'status' : undefined}>
      <span className='empty-state__icon' aria-hidden='true'>
        <Icon size={24} className={loading ? 'spin' : ''} />
      </span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export default function CafePage({ slug }) {
  const [recs, setRecs] = useState([]);
  const [isAccepting, setIsAccepting] = useState(true);
  const [notice, setNotice] = useState(null);
  const [cafeName, setCafeName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('queue');
  const [tabDirection, setTabDirection] = useState('forward');
  const [cafeTop, setCafeTop] = useState([]);
  const [cafeTopHasMore, setCafeTopHasMore] = useState(false);
  const [globalTop, setGlobalTop] = useState([]);
  const [globalTopHasMore, setGlobalTopHasMore] = useState(false);
  const [topLoading, setTopLoading] = useState(false);
  const [topLoaded, setTopLoaded] = useState({ cafeTop: false, globalTop: false });
  const [allowedPlatforms, setAllowedPlatforms] = useState(VALID_PLATFORMS);
  const [successMsg, setSuccessMsg] = useState('');
  const [successTimer, setSuccessTimer] = useState(null);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [historyExpanded, setHistoryExpanded] = useState(null);
  const [queueExpanded, setQueueExpanded] = useState(null);
  const [playbackState, setPlaybackState] = useState({
    state: PLAYBACK_STATE.UNKNOWN,
    recommendationId: null,
  });
  const swipeStart = useRef(null);
  const deviceName = getDeviceName();
  const tabs = getTabs(cafeName);

  const nowPlaying = recs.find(rec => rec.status === REC_STATUS.PLAYING) || null;
  const waitingQueue = recs
    .filter(rec => rec.status === REC_STATUS.ACCEPTED)
    .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at));
  const pendingQueue = recs
    .filter(rec => rec.status === REC_STATUS.PENDING)
    .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at));
  const history = recs
    .filter(rec => HISTORY_STATUSES.includes(rec.status))
    .sort((a, b) => new Date(b.played_at || b.requested_at) - new Date(a.played_at || a.requested_at));

  useEffect(() => {
    getRecommendations(slug)
      .then(({ recommendations, is_accepting, notice: nextNotice, cafe_name, allowed_platforms }) => {
        setRecs(recommendations);
        setIsAccepting(is_accepting);
        setNotice(nextNotice);
        setCafeName(cafe_name);
        if (allowed_platforms) setAllowedPlatforms(allowed_platforms);
      })
      .catch(caught => setError(caught.message))
      .finally(() => setLoading(false));

    const socket = getSocket(slug);
    let connected = false;

    socket.on('connect', () => {
      if (!connected) {
        connected = true;
        return;
      }

      getRecommendations(slug)
        .then(({ recommendations, is_accepting, notice: nextNotice, cafe_name, allowed_platforms }) => {
          setRecs(recommendations);
          setIsAccepting(is_accepting);
          setNotice(nextNotice);
          setCafeName(cafe_name);
          if (allowed_platforms) setAllowedPlatforms(allowed_platforms);
        })
        .catch(() => {});
    });

    socket.on('recommendations_update', ({ action, rec, id }) => {
      if (action === 'add') setRecs(previous => previous.some(item => item.id === rec.id) ? previous : [rec, ...previous]);
      if (action === 'update' || action === 'vote') setRecs(previous => previous.map(item => item.id === rec.id ? rec : item));
      if (action === 'delete') setRecs(previous => previous.filter(item => item.id !== id));
    });

    socket.on('system_toggled', ({ is_accepting }) => setIsAccepting(is_accepting));
    socket.on('notice_updated', ({ notice: nextNotice }) => setNotice(nextNotice));
    socket.on('cafe_updated', ({ cafe_name }) => setCafeName(cafe_name));
    socket.on('platforms_updated', ({ allowed_platforms }) => setAllowedPlatforms(allowed_platforms));
    socket.on('playback_state', payload => {
      if (!Object.values(PLAYBACK_STATE).includes(payload?.state)) return;
      setPlaybackState({
        state: payload.state,
        recommendationId: payload.recommendationId || null,
      });
    });
    socket.on('cafe_moved', ({ movedTo }) => {
      if (movedTo) window.location.replace(`/${movedTo}`);
    });

    return () => disconnectSocket();
  }, [slug]);

  useEffect(() => {
    if (tab === 'cafeTop' && !topLoaded.cafeTop) {
      setTopLoading(true);
      getCafeTop10(slug, 0)
        .then(({ items, hasMore }) => {
          setCafeTop(items);
          setCafeTopHasMore(hasMore);
          setTopLoaded(previous => ({ ...previous, cafeTop: true }));
        })
        .catch(() => {})
        .finally(() => setTopLoading(false));
    }

    if (tab === 'globalTop' && !topLoaded.globalTop) {
      setTopLoading(true);
      getGlobalTop10(0)
        .then(({ items, hasMore }) => {
          setGlobalTop(items);
          setGlobalTopHasMore(hasMore);
          setTopLoaded(previous => ({ ...previous, globalTop: true }));
        })
        .catch(() => {})
        .finally(() => setTopLoading(false));
    }
  }, [tab, slug, topLoaded.cafeTop, topLoaded.globalTop]);

  async function loadMoreTop() {
    setTopLoading(true);
    try {
      if (tab === 'cafeTop') {
        const { items, hasMore } = await getCafeTop10(slug, cafeTop.length);
        setCafeTop(previous => [...previous, ...items]);
        setCafeTopHasMore(hasMore);
      } else {
        const { items, hasMore } = await getGlobalTop10(globalTop.length);
        setGlobalTop(previous => [...previous, ...items]);
        setGlobalTopHasMore(hasMore);
      }
    } catch {
      // 기존 목록은 유지하고 다시 시도할 수 있게 둔다.
    } finally {
      setTopLoading(false);
    }
  }

  function handleUpdate(updated) {
    setRecs(previous => previous.map(rec => rec.id === updated.id ? updated : rec));
  }

  function handleDelete(id) {
    setRecs(previous => previous.filter(rec => rec.id !== id));
  }

  function handleAdded(rec) {
    setRecs(previous => previous.some(item => item.id === rec.id) ? previous : [rec, ...previous]);
    const position = recs.filter(item => [REC_STATUS.PENDING, REC_STATUS.ACCEPTED].includes(item.status)).length + 1;
    setSuccessMsg(`신청했어요. 현재 ${position}번째로 기다리고 있어요.`);
    if (successTimer) clearTimeout(successTimer);
    setSuccessTimer(setTimeout(() => setSuccessMsg(''), 4000));
  }

  function changeTab(nextTab) {
    if (nextTab === tab) return;
    const currentIndex = tabs.findIndex(item => item.id === tab);
    const nextIndex = tabs.findIndex(item => item.id === nextTab);
    setTabDirection(nextIndex > currentIndex ? 'forward' : 'backward');
    setTab(nextTab);
  }

  function handleSwipeStart(event) {
    if (event.touches.length !== 1 || event.target.closest?.('input, textarea, select, button, a, [role=button]')) {
      swipeStart.current = null;
      return;
    }
    const touch = event.touches[0];
    swipeStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleSwipeEnd(event) {
    if (!swipeStart.current || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - swipeStart.current.x;
    const deltaY = touch.clientY - swipeStart.current.y;
    swipeStart.current = null;

    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return;
    const currentIndex = tabs.findIndex(item => item.id === tab);
    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex >= 0 && nextIndex < tabs.length) changeTab(tabs[nextIndex].id);
  }

  if (loading) {
    return (
      <main className='app-state'>
        <LoaderCircle className='spin' size={28} aria-hidden='true' />
        <h1>신청곡을 불러오고 있어요.</h1>
      </main>
    );
  }

  if (error) {
    return (
      <main className='app-state'>
        <AlertTriangle size={28} aria-hidden='true' />
        <h1>신청곡 화면을 열지 못했어요.</h1>
        <p>{error}<br />QR 코드를 다시 스캔하거나 매장에 문의해 주세요.</p>
      </main>
    );
  }

  return (
    <main className='customer-page'>
      <header className='cafe-header'>
        <div className='cafe-header__title'>
          <h1>{cafeName || '신청곡'}</h1>
          {isAccepting && <span className='cafe-header__status'><i aria-hidden='true' />신청 가능</span>}
        </div>
      </header>

      {notice && (
        <div className='status-panel status-panel--info'>
          <Info size={18} aria-hidden='true' />
          <span>{notice}</span>
        </div>
      )}
      {!isAccepting && (
        <div className='status-panel status-panel--warning'>
          <PauseCircle size={18} aria-hidden='true' />
          <span><strong>지금은 신청을 쉬고 있어요.</strong><small>재개되면 이 화면에서 바로 신청할 수 있어요.</small></span>
        </div>
      )}

      <NowPlaying
        rec={nowPlaying}
        playbackState={playbackState.recommendationId === nowPlaying?.id
          ? playbackState.state
          : PLAYBACK_STATE.UNKNOWN}
      />

      <nav className='tabs' role='tablist' aria-label='음악 목록'>
        {tabs.map(item => (
          <button
            key={item.id}
            type='button'
            role='tab'
            aria-selected={tab === item.id}
            className={tab === item.id ? 'tabs__button is-active' : 'tabs__button'}
            onClick={() => changeTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div
        className='tab-swipe-area'
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
        onTouchCancel={() => { swipeStart.current = null; }}
      >
      {tab === 'queue' && (
        <div key='queue' className={`tab-panel tab-panel--${tabDirection}`} role='tabpanel'>
          {isAccepting && (
            <RecommendForm
              slug={slug}
              onAdded={handleAdded}
              playingVideoId={nowPlaying?.video_id}
              activeVideoIds={recs.filter(rec => ACTIVE_STATUSES.includes(rec.status)).map(rec => rec.video_id)}
              allowedPlatforms={allowedPlatforms}
            />
          )}

          {successMsg && (
            <div className='feedback feedback--success' role='status'>
              <CheckCircle2 size={18} aria-hidden='true' />
              <span>{successMsg}</span>
            </div>
          )}

          {waitingQueue.length > 0 && (
            <QueueSection title='대기 중' description='재생이 확정된 신청곡이에요.' count={waitingQueue.length}>
              {waitingQueue.map((rec, index) => (
                <div className='song-list__item' key={rec.id}>
                  <SongCard
                    slug={slug}
                    rec={rec}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onToggle={() => setQueueExpanded(value => value === rec.id ? null : rec.id)}
                    position={index + 1}
                    isMyRequest={rec.requester_name === deviceName}
                    hideStatus
                    expanded={queueExpanded === rec.id}
                  />
                  {queueExpanded === rec.id && <CommentSection videoId={rec.video_id} slug={slug} />}
                </div>
              ))}
            </QueueSection>
          )}

          {pendingQueue.length > 0 && (
            <QueueSection title='확인 중' description='매장에서 신청곡을 확인하고 있어요.' count={pendingQueue.length}>
              {pendingQueue.map((rec, index) => (
                <div className='song-list__item' key={rec.id}>
                  <SongCard
                    slug={slug}
                    rec={rec}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onToggle={() => setQueueExpanded(value => value === rec.id ? null : rec.id)}
                    position={waitingQueue.length + index + 1}
                    isMyRequest={rec.requester_name === deviceName}
                    hideStatus
                    expanded={queueExpanded === rec.id}
                  />
                  {queueExpanded === rec.id && <CommentSection videoId={rec.video_id} slug={slug} />}
                </div>
              ))}
            </QueueSection>
          )}

          {waitingQueue.length === 0 && pendingQueue.length === 0 && (
            <StatePanel title='아직 기다리는 곡이 없어요.' description='첫 번째 신청곡을 골라 보세요.' />
          )}
        </div>
      )}

      {tab === 'history' && (
        <div key='history' className={`tab-panel tab-panel--${tabDirection}`} role='tabpanel'>
          {history.length === 0 ? (
            <StatePanel title='최근 재생한 곡이 없어요.' description='재생이 끝난 곡은 여기에서 다시 볼 수 있어요.' />
          ) : (
            <section className='content-section'>
              <div className='section-heading'>
                <div><h2>최근 재생</h2><p>최근 7일 동안 매장에서 들은 곡이에요.</p></div>
              </div>
              <div className='song-list'>
                {history.slice(0, historyLimit).map(rec => (
                  <div className='song-list__item' key={rec.id}>
                    <SongCard
                      slug={slug}
                      rec={rec}
                      onUpdate={handleUpdate}
                      onToggle={() => setHistoryExpanded(value => value === rec.id ? null : rec.id)}
                      showDate
                      expanded={historyExpanded === rec.id}
                    />
                    {historyExpanded === rec.id && <CommentSection videoId={rec.video_id} slug={slug} />}
                  </div>
                ))}
              </div>
              {historyLimit < history.length && (
                <button type='button' className='button button--secondary button--full' onClick={() => setHistoryLimit(value => value + 10)}>
                  더 보기 · {history.length - historyLimit}곡 남음
                </button>
              )}
            </section>
          )}
        </div>
      )}

      {(tab === 'cafeTop' || tab === 'globalTop') && (
        <div key={tab} className={`tab-panel tab-panel--${tabDirection}`} role='tabpanel'>
          <Top10List
            items={tab === 'cafeTop' ? cafeTop : globalTop}
            hasMore={tab === 'cafeTop' ? cafeTopHasMore : globalTopHasMore}
            loading={topLoading}
            slug={tab === 'cafeTop' ? slug : null}
            onLoadMore={loadMoreTop}
          />
        </div>
      )}
      </div>

      <footer className='customer-footer'>
        <span>Caffeine Flow</span>
        <a href='/privacy.html' target='_blank' rel='noreferrer'>개인정보 처리방침</a>
      </footer>
    </main>
  );
}

function QueueSection({ title, description, count, children }) {
  return (
    <section className='content-section'>
      <div className='section-heading'>
        <div><h2>{title}</h2><p>{description}</p></div>
        <span className='count-badge'>{count}</span>
      </div>
      <div className='song-list'>{children}</div>
    </section>
  );
}

function Top10List({ items, hasMore, loading, slug, onLoadMore }) {
  const [expanded, setExpanded] = useState(null);
  const [sortBy, setSortBy] = useState('count');

  if (loading && items.length === 0) {
    return <StatePanel icon={LoaderCircle} title='인기곡을 불러오고 있어요.' loading />;
  }
  if (!loading && items.length === 0) {
    return <StatePanel title='아직 순위를 만들 데이터가 없어요.' description='신청이 쌓이면 인기곡을 보여 드릴게요.' />;
  }

  const sorted = [...items].sort((a, b) => {
    if (sortBy === 'votes') {
      const voteDifference = (b.total_votes || 0) - (a.total_votes || 0);
      return voteDifference !== 0 ? voteDifference : b.count - a.count;
    }
    const countDifference = b.count - a.count;
    return countDifference !== 0 ? countDifference : (b.total_votes || 0) - (a.total_votes || 0);
  });

  return (
    <section className='content-section'>
      <div className='section-heading'>
        <div><h2>인기곡</h2><p>신청과 좋아요를 기준으로 모았어요.</p></div>
      </div>
      <div className='segmented-control' aria-label='인기곡 정렬'>
        <button type='button' aria-pressed={sortBy === 'count'} onClick={() => setSortBy('count')}>신청순</button>
        <button type='button' aria-pressed={sortBy === 'votes'} onClick={() => setSortBy('votes')}>좋아요순</button>
      </div>
      <ol className='rank-list'>
        {sorted.map((item, index) => {
          const rowKey = `${item.video_id}__${index}`;
          const isExpanded = expanded === rowKey;
          return (
            <li className='rank-list__item' key={rowKey}>
              <button type='button' className='rank-row' aria-expanded={isExpanded} onClick={() => setExpanded(value => value === rowKey ? null : rowKey)}>
                <span className='rank-row__number'>{index + 1}</span>
                <SongThumbnail
                  src={item.thumbnail}
                  className='rank-row__thumbnail'
                  fallbackClassName='rank-row__thumbnail--empty'
                  iconSize={18}
                />
                <span className='rank-row__info'>
                  <strong>{item.title}</strong>
                  <small>{item.channel_title} · {item.count}회 신청</small>
                </span>
                <span className='rank-row__votes'><Heart size={14} aria-hidden='true' /> {item.total_votes || 0}</span>
                {isExpanded ? <ChevronUp size={18} aria-hidden='true' /> : <ChevronDown size={18} aria-hidden='true' />}
              </button>
              {isExpanded && <CommentSection videoId={item.video_id} slug={slug} />}
            </li>
          );
        })}
      </ol>
      {hasMore && (
        <button type='button' className='button button--secondary button--full' onClick={onLoadMore} disabled={loading}>
          {loading ? '불러오는 중...' : '더 보기'}
        </button>
      )}
    </section>
  );
}

function CommentSection({ videoId, slug }) {
  const [comments, setComments] = useState(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const deviceName = getDeviceName();

  useEffect(() => {
    getSongComments(videoId).then(setComments).catch(() => setComments([]));
  }, [videoId]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError('');
    try {
      const comment = await postSongComment(videoId, slug, { commenterName: deviceName, body: body.trim() });
      setComments(previous => [comment, ...(previous || [])]);
      setBody('');
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
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
        {error && <p className='form-error' role='alert'>{error}</p>}
        {body.trim() && (
          <div className='comment-form__actions'>
            <button type='button' className='button button--text' onClick={() => setBody('')}>돌아가기</button>
            <button type='submit' className='button button--primary button--compact' disabled={loading}>
              <Send size={15} aria-hidden='true' /> {loading ? '등록 중...' : '댓글 등록하기'}
            </button>
          </div>
        )}
      </form>

      {comments === null && <p className='comments__state'>댓글을 불러오고 있어요.</p>}
      {comments?.length === 0 && <p className='comments__state'>아직 댓글이 없어요.<br />첫 번째 이야기를 남겨 보세요.</p>}
      {comments?.map(comment => (
        <CommentItem
          key={comment.id}
          comment={comment}
          videoId={videoId}
          slug={slug}
          deviceName={deviceName}
          onReplyAdded={reply => setComments(previous => previous.map(item => item.id === comment.id ? { ...item, replies: [...item.replies, reply] } : item))}
        />
      ))}
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
