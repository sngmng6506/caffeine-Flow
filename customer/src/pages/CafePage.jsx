import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  LoaderCircle,
  PauseCircle,
} from 'lucide-react';
import { REC_STATUS } from '../constants/recommendationStatus';
import { PLAYBACK_STATE } from '../constants/playbackState';
import NowPlaying from './NowPlaying';
import RecommendForm from './RecommendForm';
import SongCard from './SongCard';
import CafeComments from './CafeComments';
import StatePanel from './StatePanel';
import Top10List from './Top10List';
import useCafeHistory from './cafe/useCafeHistory';
import useCafeQueue from './cafe/useCafeQueue';
import useTopSongs from './cafe/useTopSongs';

function getTabs(cafeName) {
  return [
    { id: 'queue', label: '신청곡' },
    { id: 'history', label: '최근 재생' },
    { id: 'cafeTop', label: cafeName ? `${cafeName} TOP` : '매장 TOP' },
    { id: 'globalTop', label: '전체 TOP' },
  ];
}

export default function CafePage({ slug }) {
  const [tab, setTab] = useState('queue');
  const [tabDirection, setTabDirection] = useState('forward');
  const [successMsg, setSuccessMsg] = useState('');
  const [successTimer, setSuccessTimer] = useState(null);
  const [copyNotice, setCopyNotice] = useState(null);
  const [historyExpanded, setHistoryExpanded] = useState(null);
  const [queueExpanded, setQueueExpanded] = useState(null);
  const swipeStart = useRef(null);
  const swipeClickTimer = useRef(null);
  const copyNoticeTimer = useRef(null);

  const historyData = useCafeHistory({ slug, active: tab === 'history' });
  const topData = useTopSongs({ slug, tab });
  const {
    items: history,
    hasMore: historyHasMore,
    loading: historyLoading,
    error: historyError,
    loadMore: loadMoreHistory,
    retry: retryHistory,
    upsertRecommendation: upsertHistoryRecommendation,
    updateRecommendation: updateHistoryRecommendation,
    patchSongVote: patchHistorySongVote,
  } = historyData;
  const {
    items: topItems,
    hasMore: topHasMore,
    loading: topLoading,
    error: topError,
    sortBy: topSort,
    retry: retryTop,
    loadMore: loadMoreTop,
    changeSort: changeTopSort,
    patchSongVote: patchTopSongVote,
    toggleVote: toggleTopVote,
  } = topData;

  const handleRealtimeSongVote = useCallback((trackKey, voteCount) => {
    patchHistorySongVote(trackKey, voteCount);
    patchTopSongVote(trackKey, voteCount);
  }, [patchHistorySongVote, patchTopSongVote]);

  const queueData = useCafeQueue({
    slug,
    onHistoryTransition: upsertHistoryRecommendation,
    onHistoryUpdate: updateHistoryRecommendation,
    onSongVote: handleRealtimeSongVote,
  });
  const {
    recommendations: recs,
    isAccepting,
    notice,
    cafeName,
    allowedPlatforms,
    playbackState,
    loading,
    error,
    nowPlaying,
    waitingQueue,
    pendingQueue,
    activeVideoIds,
    addRecommendation,
    updateRecommendation,
    removeRecommendation,
    patchSongVote: patchQueueSongVote,
  } = queueData;
  const tabs = getTabs(cafeName);

  useEffect(() => () => {
    if (swipeClickTimer.current) clearTimeout(swipeClickTimer.current);
    if (copyNoticeTimer.current) clearTimeout(copyNoticeTimer.current);
  }, []);

  function handleUpdate(updated) {
    updateRecommendation(updated);
  }

  // 전체 TOP은 다른 매장의 곡도 보여주지만 좋아요는 손님이 있는 이 매장에 남는다.
  async function handleTopVote(trackKey, voted) {
    try {
      const voteCount = await toggleTopVote(trackKey, voted);
      patchQueueSongVote(trackKey, voteCount);
      patchHistorySongVote(trackKey, voteCount);
    } catch (caught) {
      handleCopyResult({ type: 'error', message: caught.message });
    }
  }

  function handleDelete(id) {
    removeRecommendation(id);
  }

  function handleCopyResult(result) {
    setCopyNotice(result);
    if (copyNoticeTimer.current) clearTimeout(copyNoticeTimer.current);
    copyNoticeTimer.current = setTimeout(() => setCopyNotice(null), 2500);
  }

  function handleAdded(rec) {
    addRecommendation(rec);
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

  function handleTabKeyDown(event, currentTab) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabs.findIndex(item => item.id === currentTab);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex].id;
    changeTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`music-tab-${nextTab}`)?.focus());
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
        rec={playbackState.track ? {
          title: playbackState.track.title,
          channel_title: playbackState.track.artist,
          thumbnail: playbackState.track.thumbnail,
          platform: playbackState.track.platform,
          video_id: playbackState.track.videoId,
          comment_key: playbackState.track.commentKey,
        } : nowPlaying}
        commentKey={playbackState.recommendationId === nowPlaying?.id
          ? nowPlaying.video_id
          : playbackState.track?.commentKey || nowPlaying?.video_id || null}
        slug={slug}
        playbackState={playbackState.track
          ? playbackState.state
          : playbackState.recommendationId === nowPlaying?.id
            ? playbackState.state
            : PLAYBACK_STATE.UNKNOWN}
      />

      <nav className={tab === 'cafeTop' ? 'tabs tabs--cafe-active' : 'tabs'} role='tablist' aria-label='음악 목록'>
        {tabs.map(item => (
          <button
            key={item.id}
            type='button'
            id={`music-tab-${item.id}`}
            role='tab'
            aria-selected={tab === item.id}
            aria-controls={`music-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={tab === item.id ? 'tabs__button is-active' : 'tabs__button'}
            onClick={() => changeTab(item.id)}
            onKeyDown={event => handleTabKeyDown(event, item.id)}
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
        <div id='music-panel-queue' aria-labelledby='music-tab-queue' key='queue' className={`tab-panel tab-panel--${tabDirection}`} role='tabpanel'>
          {isAccepting && (
            <RecommendForm
              slug={slug}
              onAdded={handleAdded}
              playingVideoId={nowPlaying?.video_id}
              activeVideoIds={activeVideoIds}
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
                    compact
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
                    compact
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
        <div id='music-panel-history' aria-labelledby='music-tab-history' key='history' className={`tab-panel tab-panel--${tabDirection}`} role='tabpanel'>
          {historyLoading && history.length === 0 ? (
            <StatePanel icon={LoaderCircle} title='최근 재생을 불러오고 있어요.' loading />
          ) : historyError && history.length === 0 ? (
            <>
              <StatePanel title='최근 재생을 불러오지 못했어요.' description={historyError} />
              <button type='button' className='button button--secondary button--full' onClick={retryHistory}>
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
                      compact
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
        <div id={`music-panel-${tab}`} aria-labelledby={`music-tab-${tab}`} key={tab} className={`tab-panel tab-panel--${tabDirection}`} role='tabpanel'>
          <Top10List
            items={topItems}
            hasMore={topHasMore}
            loading={topLoading}
            slug={tab === 'cafeTop' ? slug : null}
            voteSlug={slug}
            sortBy={topSort}
            error={topError}
            onRetry={retryTop}
            onSortChange={changeTopSort}
            onLoadMore={loadMoreTop}
            onCopyResult={handleCopyResult}
            onVote={handleTopVote}
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
