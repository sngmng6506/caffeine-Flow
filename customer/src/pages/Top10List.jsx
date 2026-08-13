import { useState } from 'react';
import { ChevronDown, ChevronUp, Heart, LoaderCircle } from 'lucide-react';
import LongPressCopy from '../components/LongPressCopy';
import SongThumbnail from '../components/SongThumbnail';
import CafeComments from './CafeComments';
import StatePanel from './StatePanel';

export default function Top10List({ items, hasMore, loading, slug, sortBy, onSortChange, onLoadMore, onCopyResult }) {
  const [expanded, setExpanded] = useState(null);

  if (loading && items.length === 0) {
    return <StatePanel icon={LoaderCircle} title='인기곡을 불러오고 있어요.' loading />;
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
          return (
            <li className='rank-list__item' key={rowKey}>
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
                  <span className='rank-row__votes'><Heart size={14} aria-hidden='true' /> {item.total_votes || 0}</span>
                  {isExpanded ? <ChevronUp size={18} aria-hidden='true' /> : <ChevronDown size={18} aria-hidden='true' />}
                </button>
              </LongPressCopy>
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
