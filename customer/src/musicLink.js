export function musicLinkFromVideoId(videoId) {
  const value = String(videoId || '').trim();
  if (!value) return '';

  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    // URL이 아니면 YouTube 영상 ID로 처리한다.
  }

  return 'https://www.youtube.com/watch?v=' + encodeURIComponent(value);
}

function copyWithTextarea(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('copy_failed');
}

export async function copyMusicLink(videoId) {
  const link = musicLinkFromVideoId(videoId);
  if (!link) throw new Error('missing_music_link');

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(link);
      return link;
    } catch {
      // 권한이 없는 브라우저에서는 동기식 복사 방식으로 다시 시도한다.
    }
  }

  copyWithTextarea(link);
  return link;
}
