import { useState } from 'react';
import { Link2, LoaderCircle, Search, Send, X } from 'lucide-react';
import { getOembed, postRecommendation } from '../api';
import { getDeviceName } from '../deviceName';
import { PLATFORM, PLATFORM_BADGE, PLATFORM_LINKS, VALID_PLATFORMS, platformLabel } from '../constants/platforms';
import SongThumbnail from '../components/SongThumbnail';

function YouTubeIcon() {
  return (
    <svg width='34' height='24' viewBox='0 0 38 27' fill='none' aria-hidden='true'>
      <rect width='38' height='27' rx='7' fill='#FF0000' />
      <polygon points='15,7 15,20 26,13.5' fill='white' />
    </svg>
  );
}

function SpotifyIcon() {
  return (
    <svg width='26' height='26' viewBox='0 0 27 27' fill='none' aria-hidden='true'>
      <circle cx='13.5' cy='13.5' r='13.5' fill='#1DB954' />
      <path d='M7 10.5c4-2 9-2 13 0' stroke='white' strokeWidth='2' fill='none' strokeLinecap='round' />
      <path d='M7.5 14c3.5-1.5 8-1.5 12 0' stroke='white' strokeWidth='1.8' fill='none' strokeLinecap='round' />
      <path d='M8 17.5c3-1.2 6.5-1.2 11 0' stroke='white' strokeWidth='1.5' fill='none' strokeLinecap='round' />
    </svg>
  );
}

function SoundCloudIcon() {
  return (
    <svg width='34' height='24' viewBox='0 0 38 27' fill='none' aria-hidden='true'>
      <rect width='38' height='27' rx='7' fill='#FF5500' />
      <path d='M8 18.5 Q8 15 11 15 Q11 11 14.5 11 Q15 8 18 8 Q22 8 22 12.5 L22 18.5 Z' fill='white' opacity='0.9' />
      <rect x='24' y='12' width='2' height='7' rx='1' fill='white' opacity='0.7' />
      <rect x='27.5' y='10' width='2' height='9' rx='1' fill='white' opacity='0.7' />
      <rect x='31' y='13' width='2' height='6' rx='1' fill='white' opacity='0.7' />
    </svg>
  );
}

const PLATFORM_ICONS = Object.freeze({
  [PLATFORM.YOUTUBE]: <YouTubeIcon />,
  [PLATFORM.SPOTIFY]: <SpotifyIcon />,
  [PLATFORM.SOUNDCLOUD]: <SoundCloudIcon />,
});

export default function RecommendForm({ slug, onAdded, activeVideoIds = [], playingVideoId, allowedPlatforms = VALID_PLATFORMS }) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('input');
  const [composerOpen, setComposerOpen] = useState(false);

  function closeComposer() {
    setComposerOpen(false);
    setUrl('');
    setError('');
  }

  async function handlePreview(event) {
    event.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError('');

    try {
      const data = await getOembed(url.trim());
      if (data.platform && !allowedPlatforms.includes(data.platform)) {
        setError(`이 매장에서는 ${platformLabel(data.platform)} 신청곡을 받고 있지 않아요.`);
        setUrl('');
        return;
      }
      if (data.videoId === playingVideoId) {
        setError('지금 재생 중인 곡이에요. 다른 곡을 선택해 주세요.');
        setUrl('');
        return;
      }
      if (activeVideoIds.includes(data.videoId)) {
        setError('이미 대기 중인 곡이에요. 다른 곡을 선택해 주세요.');
        setUrl('');
        return;
      }
      setPreview(data);
      setStep('preview');
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    setLoading(true);
    setError('');

    try {
      const rec = await postRecommendation(slug, {
        metadataToken: preview.metadataToken,
        requesterName: getDeviceName(),
      });
      onAdded(rec);
      setUrl('');
      setPreview(null);
      setStep('input');
      setComposerOpen(false);
    } catch (caught) {
      setError(caught.message);
      setUrl('');
      setPreview(null);
      setStep('input');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'preview' && preview) {
    const badge = PLATFORM_BADGE[preview.platform] || PLATFORM_BADGE[PLATFORM.YOUTUBE];
    return (
      <section className='request-card' aria-labelledby='request-preview-title'>
        <div className='request-card__heading'>
          <div>
            <h2 id='request-preview-title'>이 곡이 맞나요?</h2>
          </div>
        </div>

        <div className='request-preview'>
          <SongThumbnail
            src={preview.thumbnail}
            className='request-preview__thumb'
            fallbackClassName='request-preview__thumb--fallback'
            iconSize={22}
          />
          <div className='request-preview__info'>
            <span className='platform-badge' style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
            <strong>{preview.title}</strong>
            <span>{preview.channelTitle}</span>
          </div>
        </div>

        {error && <div className='feedback feedback--error' role='alert'>{error}</div>}

        <div className='request-card__actions'>
          <button type='button' onClick={() => setStep('input')} className='button button--secondary' disabled={loading}>
            <X size={17} aria-hidden='true' />
            취소
          </button>
          <button type='button' onClick={handleSubmit} disabled={loading} className='button button--primary'>
            {loading ? <LoaderCircle className='is-spinning' size={18} aria-hidden='true' /> : <Send size={18} aria-hidden='true' />}
            {loading ? '신청 중…' : '신청'}
          </button>
        </div>
      </section>
    );
  }

  if (!composerOpen) {
    return (
      <section className='request-composer' aria-label='신청곡 추가'>
        <button type='button' className='request-composer__trigger' onClick={() => setComposerOpen(true)}>
          <span className='request-composer__icon' aria-hidden='true'><Link2 size={18} /></span>
          <span>듣고 싶은 곡이 있나요?</span>
          <strong>입력</strong>
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={handlePreview} className='request-card request-card--input' aria-label='신청곡 추가'>
      <div className='request-card__topline'>
        <label className='field-label' htmlFor='music-url'>음악 링크</label>
        <button type='button' className='icon-button request-card__close' onClick={closeComposer} aria-label='신청곡 추가 닫기' disabled={loading}>
          <X size={18} aria-hidden='true' />
        </button>
      </div>
      <div className='input-shell'>
        <Link2 size={18} aria-hidden='true' />
        <input
          id='music-url'
          type='url'
          inputMode='url'
          placeholder='음악 링크를 붙여 넣어 주세요'
          value={url}
          onChange={event => setUrl(event.target.value)}
          autoComplete='off'
        />
      </div>

      {error && <div className='feedback feedback--error request-card__input-error' role='alert'>{error}</div>}

      <button type='submit' disabled={loading || !url.trim()} className='button button--primary button--full'>
        {loading ? <LoaderCircle className='is-spinning' size={18} aria-hidden='true' /> : <Search size={18} aria-hidden='true' />}
        {loading ? '곡 정보를 확인하고 있어요' : '신청곡 확인하기'}
      </button>

      <div className='platform-shortcuts'>
        <span className='platform-shortcuts__label'>음악 찾기</span>
        <div className='platform-shortcuts__links'>
          {PLATFORM_LINKS.map(({ id, href }) => {
            const allowed = allowedPlatforms.includes(id);
            const label = platformLabel(id);
            const icon = PLATFORM_ICONS[id];
            return allowed ? (
              <a
                key={id}
                href={href}
                target='_blank'
                rel='noopener noreferrer'
                className='platform-shortcut'
                aria-label={`${label}에서 음악 찾기, 새 창`}
                title={`${label}에서 음악 찾기`}
              >
                {icon}
              </a>
            ) : (
              <span key={id} className='platform-shortcut platform-shortcut--disabled' aria-label={`${label} 신청 불가`}>
                {icon}
              </span>
            );
          })}
        </div>
      </div>
    </form>
  );
}
