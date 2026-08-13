import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  LoaderCircle,
  PauseCircle,
} from 'lucide-react';
import {
  getRecommendations,
  getRecentHistory,
  getCafeTop10,
  getGlobalTop10,
} from '../api';
import { getSocket, disconnectSocket } from '../socket';
import { VALID_PLATFORMS } from '../constants/platforms';
import { ACTIVE_STATUSES, HISTORY_STATUSES, REC_STATUS } from '../constants/recommendationStatus';
import { PLAYBACK_STATE } from '../constants/playbackState';
import NowPlaying from './NowPlaying';
import RecommendForm from './RecommendForm';
import SongCard from './SongCard';
import CafeComments from './CafeComments';
import StatePanel from './StatePanel';
import Top10List from './Top10List';

function getTabs(cafeName) {
  return [
    { id: 'queue', label: '신청곡' },
    { id: 'history', label: '최근 재생' },
    { id: 'cafeTop', label: cafeName ? `${cafeName} TOP` : '매장 TOP' },
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
  const [tabDirection, setTabDirection] = useState('forward');
  const [cafeTop, setCafeTop] = useState([]);
  const [cafeTopHasMore, setCafeTopHasMore] = useState(false);
  const [globalTop, setGlobalTop] = useState([]);
  const [globalTopHasMore, setGlobalTopHasMore] = useState(false);
  const [topLoading, setTopLoading] = useState(false);
  const [topLoaded, setTopLoaded] = useState({ cafeTop: false, globalTop: false });
  const [topSort, setTopSort] = useState({ cafeTop: 'count', globalTop: 'count' });
  const [allowedPlatforms, setAllowedPlatforms] = useState(VALID_PLATFORMS);
  const [successMsg, setSuccessMsg] = useState('');
  const [successTimer, setSuccessTimer] = useState(null);
  const [copyNotice, setCopyNotice] = useState(null);
  const [historyRecs, setHistoryRecs] = useState([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyRetry, setHistoryRetry] = useState(0);
  const [historyExpanded, setHistoryExpanded] = useState(null);
  const [queueExpanded, setQueueExpanded] = useState(null);
  const [playbackState, setPlaybackState] = useState({
    state: PLAYBACK_STATE.UNKNOWN,
    recommendationId: null,
  });
  const swipeStart = useRef(null);
  const swipeClickTimer = useRef(null);
  const copyNoticeTimer = useRef(null);
  const tabs = getTabs(cafeName);

  useEffect(() => () => {
    if (swipeClickTimer.current) clearTimeout(swipeClickTimer.current);
    if (copyNoticeTimer.current) clearTimeout(copyNoticeTimer.current);
  }, []);

  useEffect(() => {
    setHistoryRecs([]);
    setHistoryHasMore(false);
    setHistoryLoaded(false);
    setHistoryError('');
    setCafeTop([]);
    setGlobalTop([]);
    setTopLoaded({ cafeTop: false, globalTop: false });
  }, [slug]);

  const nowPlaying = recs.find(rec => rec.status === REC_STATUS.PLAYING) || null;
  const waitingQueue = recs
    .filter(rec => rec.status === REC_STATUS.ACCEPTED)
    .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at));
  const pendingQueue = recs
    .filter(rec => rec.status === REC_STATUS.PENDING)
    .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at));
  const history = [...historyRecs]
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
      if (action === 'update' || action === 'vote') {
        if (HISTORY_STATUSES.includes(rec.status)) {
          setRecs(previous => previous.filter(item => item.id !== rec.id));
          setHistoryRecs(previous => previous.some(item => item.id === rec.id)
            ? previous.map(item => item.id === rec.id ? rec : item)
            : [rec, ...previous]);
        } else {
          setRecs(previous => previous.map(item => item.id === rec.id ? { ...rec, is_mine: item.is_mine } : item));
        }
      }
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
    if (tab !== 'history' || historyLoaded) return;
    setHistoryLoading(true);
    setHistoryError('');
    getRecentHistory(slug, 0)
      .then(({ items, hasMore }) => {
        setHistoryRecs(items);
        setHistoryHasMore(hasMore);
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryError('최근 재생을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'))
      .finally(() => setHistoryLoading(false));
  }, [tab, slug, historyLoaded, historyRetry]);

  useEffect(() => {
    if (tab === 'cafeTop' && !topLoaded.cafeTop) {
      setTopLoading(true);
      getCafeTop10(slug, 0, topSort.cafeTop)
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
      getGlobalTop10(0, topSort.globalTop)
        .then(({ items, hasMore }) => {
          setGlobalTop(items);
          setGlobalTopHasMore(hasMore);
          setTopLoaded(previous => ({ ...previous, globalTop: true }));
        })
        .catch(() => {})
        .finally(() => setTopLoading(false));
    }
  }, [tab, slug, topLoaded.cafeTop, topLoaded.globalTop, topSort.cafeTop, topSort.globalTop]);

  async function loadMoreTop() {
    setTopLoading(true);
    try {
      if (tab === 'cafeTop') {
        const { items, hasMore } = await getCafeTop10(slug, cafeTop.length, topSort.cafeTop);
        setCafeTop(previous => [...previous, ...items]);
        setCafeTopHasMore(hasMore);
      } else {
        const { items, hasMore } = await getGlobalTop10(globalTop.length, topSort.globalTop);
        setGlobalTop(previous => [...previous, ...items]);
        setGlobalTopHasMore(hasMore);
      }
    } catch {
      // 기존 목록은 유지하고 다시 시도할 수 있게 둔다.
    } finally {
      setTopLoading(false);
    }
  }

  async function changeTopSort(sort) {
    if (!['count', 'votes'].includes(sort) || sort === topSort[tab]) return;
    setTopSort(previous => ({ ...previous, [tab]: sort }));
    setTopLoading(true);
    try {
      const result = tab === 'cafeTop'
        ? await getCafeTop10(slug, 0, sort)
        : await getGlobalTop10(0, sort);
      if (tab === 'cafeTop') {
        setCafeTop(result.items);
        setCafeTopHasMore(result.hasMore);
      } else {
        setGlobalTop(result.items);
        setGlobalTopHasMore(result.hasMore);
      }
    } catch {
      setTopSort(previous => ({ ...previous, [tab]: topSort[tab] }));
    } finally {
      setTopLoading(false);
    }
  }

  async function loadMoreHistory() {
    setHistoryLoading(true);
    try {
      const { items, hasMore } = await getRecentHistory(slug, historyRecs.length);
      setHistoryRecs(previous => [...previous, ...items.filter(item => !previous.some(existing => existing.id === item.id))]);
      setHistoryHasMore(hasMore);
    } catch {
      // 기존 이력은 유지하고 다시 시도할 수 있게 둔다.
    } finally {
      setHistoryLoading(false);
    }
  }

  function handleUpdate(updated) {
    if (HISTORY_STATUSES.includes(updated.status)) {
      setHistoryRecs(previous => previous.map(rec => rec.id === updated.id ? updated : rec));
    } else {
      setRecs(previous => previous.map(rec => rec.id === updated.id ? updated : rec));
    }
  }

  function handleDelete(id) {
    setRecs(previous => previous.filter(rec => rec.id !== id));
  }

  function handleCopyResult(result) {
    setCopyNotice(result);
    if (copyNoticeTimer.current) clearTimeout(copyNoticeTimer.current);
    copyNoticeTimer.current = setTimeout(() => setCopyNotice(null), 2500);
  }

  function handleAdded(rec) {
    setRecs(previous => previous.some(item => item.id === rec.id)
      ? previous.map(item => item.id === rec.id ? rec : item)
      : [rec, ...previous]);
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
    if (event.touches.length !== 1 || event.target.closest?.('input, textarea, select, a')) {
      swipeStart.current = null;
      return;
    }
    const touch = event.touches[0];
    swipeStart.current = { x: touch.clientX, y: touch.clientY, axis: null };
  }

  function handleSwipeMove(event) {
    const gesture = swipeStart.current;
    if (!gesture || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const deltaX = touch.clientX - gesture.x;
    const deltaY = touch.clientY - gesture.y;
    const horizontalDistance = Math.abs(deltaX);
    const verticalDistance = Math.abs(deltaY);

    if (!gesture.axis && Math.max(horizontalDistance, verticalDistance) >= 8) {
      gesture.axis = horizontalDistance >= verticalDistance * 0.9 ? 'horizontal' : 'vertical';
    }
    if (gesture.axis === 'horizontal') event.preventDefault();
  }

  function handleSwipeEnd(event) {
    if (!swipeStart.current || event.changedTouches.length !== 1) return;
    const gesture = swipeStart.current;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - gesture.x;
    swipeStart.current = null;

    if (gesture.axis !== 'horizontal' || Math.abs(deltaX) < 44) return;
    const currentIndex = tabs.findIndex(item => item.id === tab);
    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    if (swipeClickTimer.current) clearTimeout(swipeClickTimer.current);
    swipeClickTimer.current = setTimeout(() => { swipeClickTimer.current = null; }, 450);
    if (nextIndex >= 0 && nextIndex < tabs.length) {
      changeTab(tabs[nextIndex].id);
    }
  }

  function handleSwipeClickCapture(event) {
    if (!swipeClickTimer.current) return;
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(swipeClickTimer.current);
    swipeClickTimer.current = null;
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
        <div className='status-panel status-panel--notice'>
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

      <nav className={tab === 'cafeTop' ? 'tabs tabs--cafe-active' : 'tabs'} role='tablist' aria-label='음악 목록'>
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
        onTouchMove={handleSwipeMove}
        onTouchEnd={handleSwipeEnd}
        onTouchCancel={() => { swipeStart.current = null; }}
        onClickCapture={handleSwipeClickCapture}
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
                    onLinkCopyResult={handleCopyResult}
                    position={index + 1}
                    isMyRequest={rec.is_mine}
                    hideStatus
                    expanded={queueExpanded === rec.id}
                  />
                  {queueExpanded === rec.id && <CafeComments videoId={rec.video_id} slug={slug} />}
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
                    onLinkCopyResult={handleCopyResult}
                    position={waitingQueue.length + index + 1}
                    isMyRequest={rec.is_mine}
                    hideStatus
                    expanded={queueExpanded === rec.id}
                  />
                  {queueExpanded === rec.id && <CafeComments videoId={rec.video_id} slug={slug} />}
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
          {historyLoading && history.length === 0 ? (
            <StatePanel icon={LoaderCircle} title='최근 재생을 불러오고 있어요.' loading />
          ) : historyError && history.length === 0 ? (
            <>
              <StatePanel title='최근 재생을 불러오지 못했어요.' description={historyError} />
              <button type='button' className='button button--secondary button--full' onClick={() => setHistoryRetry(value => value + 1)}>
                다시 시도
              </button>
            </>
          ) : history.length === 0 ? (
            <StatePanel title='최근 재생한 곡이 없어요.' description='재생이 끝난 곡은 여기에서 다시 볼 수 있어요.' />
          ) : (
            <section className='content-section'>
              <div className='section-heading'>
                <div><h2>최근 재생</h2><p>최근 7일 동안 매장에서 들은 곡이에요.</p></div>
              </div>
              <div className='song-list'>
                {history.map(rec => (
                  <div className='song-list__item' key={rec.id}>
                    <SongCard
                      slug={slug}
                      rec={rec}
                      onUpdate={handleUpdate}
                      onToggle={() => setHistoryExpanded(value => value === rec.id ? null : rec.id)}
                      onLinkCopyResult={handleCopyResult}
                      showDate
                      expanded={historyExpanded === rec.id}
                    />
                    {historyExpanded === rec.id && <CafeComments videoId={rec.video_id} slug={slug} />}
                  </div>
                ))}
              </div>
              {historyHasMore && (
                <button type='button' className='button button--secondary button--full' onClick={loadMoreHistory} disabled={historyLoading}>
                  {historyLoading ? '불러오는 중...' : '더 보기'}
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
            sortBy={topSort[tab]}
            onSortChange={changeTopSort}
            onLoadMore={loadMoreTop}
            onCopyResult={handleCopyResult}
          />
        </div>
      )}
      </div>

      {copyNotice && (
        <div className={`copy-toast copy-toast--${copyNotice.type}`} role={copyNotice.type === 'error' ? 'alert' : 'status'}>
          {copyNotice.type === 'error'
            ? <AlertTriangle size={18} aria-hidden='true' />
            : <CheckCircle2 size={18} aria-hidden='true' />}
          <span>{copyNotice.message}</span>
        </div>
      )}

      <footer className='customer-footer'>
        <div>
          <span>Caffeine Flow</span>
          <a className='customer-footer__developer' href='https://github.com/sngmng6506' target='_blank' rel='noopener noreferrer'>
            Dev info · github.com/sngmng6506
          </a>
        </div>
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
