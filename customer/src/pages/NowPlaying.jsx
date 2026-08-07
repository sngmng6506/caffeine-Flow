import { AudioLines } from 'lucide-react';
import SongThumbnail from '../components/SongThumbnail';

export default function NowPlaying({ rec }) {
  if (!rec) return null;

  return (
    <section className='now-playing' aria-label='현재 재생 중인 곡'>
      <div className='now-playing__status'>
        <AudioLines size={16} aria-hidden='true' />
        <span>재생 중</span>
        <span className='now-playing__pulse' aria-hidden='true' />
      </div>
      <div className='now-playing__content'>
        <SongThumbnail
          src={rec.thumbnail}
          className='now-playing__thumb'
          fallbackClassName='now-playing__thumb--fallback'
          iconSize={24}
        />
        <div className='now-playing__info'>
          <h2 className='now-playing__title'>{rec.title}</h2>
          <p className='now-playing__channel'>{rec.channel_title}</p>
        </div>
      </div>
    </section>
  );
}
