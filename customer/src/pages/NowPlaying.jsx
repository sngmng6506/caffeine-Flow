import { AudioLines, Music2 } from 'lucide-react';

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
        {rec.thumbnail
          ? <img src={rec.thumbnail} alt='' className='now-playing__thumb' />
          : (
            <div className='now-playing__thumb now-playing__thumb--fallback'>
              <Music2 size={24} aria-hidden='true' />
            </div>
          )
        }
        <div className='now-playing__info'>
          <h2 className='now-playing__title'>{rec.title}</h2>
          <p className='now-playing__channel'>{rec.channel_title}</p>
        </div>
      </div>
    </section>
  );
}
