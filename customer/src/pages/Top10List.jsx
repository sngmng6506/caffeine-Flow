import { useState } from 'react';
import { ChevronDown, ChevronUp, Heart, LoaderCircle } from 'lucide-react';
import LongPressCopy from '../components/LongPressCopy';
import SongThumbnail from '../components/SongThumbnail';
import CafeComments from './CafeComments';
import StatePanel from './StatePanel';
import { hasVoted } from '../votedSongs';
import { trackKeyOf } from '../trackKey';

// voteSlug는 항상 지금 보고 있는 매장이다. 전체 TOP은 다른 매장의 곡도 보여주지만
// 좋아요는 손님이 있는 매장에 남는다 — slug(댓글 범위)와 구분해서 받는다.
export default function Top10List({ items, hasMore, loading, slug, voteSlug, sortBy, error, onRetry, onSortChange, onLoadMore, onCopyResult, onVote }) {
  const [expanded, setExpanded] = useState(null);
  const [voting, setVoting] = useState(null);

  if (loading && items.length === 0) {
    return <StatePanel icon={LoaderCircle} title='인기곡을 불러오고 있어요.' loading />;
  }
  // 못 불러온 것과 아직 없는 것을 구분한다 — 실패를 "데이터 없음"으로 보여주면
  // 손님은 다시 시도할 이유를 알 수 없다.
  if (error && items.length === 0) {
    return (
      <>
        <StatePanel title='인기곡을 불러오지 못했어요.' description={error} />
        <button type='button' className='button button--secondary button--full' onClick={onRetry}>
          다시 시도
        </button>
      </>
    );
  }
  if (!loading && items.length === 0) {
    return <StatePanel title='아직 순위를 만들 데이터가 없어요.' description='곡이 재생되면 인기곡을 보여 드릴게요.' />;
  }

  return (
    <section className='content-section'>
      <div className='section-heading'>
        <div><h2>인기곡</h2><p>실제로 재생된 곡의 재생 횟수와 좋아요를 기준으로 모았어요.</p></div>
      </div>
      <div className='segmented-control' aria-label='인기곡 정렬'>
        <button type='button' aria-pressed={sortBy === 'count'} onClick={() => onSortChange('count')} disabled={loading}>재생순</button>
        <button type='button' aria-pressed={sortBy === 'votes'} onClick={() => onSortChange('votes')} disabled={loading}>좋아요순</button>
      </div>
      <ol className='rank-list'>
        {items.map((item, index) => {
          const rowKey = `${item.video_id}__${index}`;
          const isExpanded = expanded === rowKey;
          const trackKey = trackKeyOf(item.video_id);
          const voted = voteSlug ? hasVoted(voteSlug, trackKey) : false;
          return (
            <li className='rank-list__item' key={rowKey}>
              <div className='rank-row-line'>
                <LongPressCopy videoId={item.video_id} onResult={onCopyResult}>
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
                      <small>{item.channel_title} · {item.count}회 재생</small>
                    </span>
                    {isExpanded ? <ChevronUp size={18} aria-hidden='true' /> : <ChevronDown size={18} aria-hidden='true' />}
                  </button>
                </LongPressCopy>
                <button
                  type='button'
                  className={`pill-action rank-row__vote${voted ? ' pill-action--active' : ''}`}
                  onClick={() => { setVoting(rowKey); Promise.resolve(onVote?.(trackKey, voted)).finally(() => setVoting(null)); }}
                  disabled={!voteSlug || voting === rowKey}
                  aria-pressed={voted}
                  aria-label={`좋아요 ${item.total_votes || 0}개${voted ? ', 선택됨' : ''}`}
                >
                  <Heart size={14} fill={voted ? 'currentColor' : 'none'} aria-hidden='true' />
                  <strong>{item.total_votes || 0}</strong>
                </button>
              </div>
              {isExpanded && <CafeComments videoId={item.video_id} slug={slug} />}
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
