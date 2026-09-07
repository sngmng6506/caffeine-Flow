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
  const activeElement = document.activeElement;
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.fontSize = '16px';
  document.body.appendChild(textarea);
  let copied;
  try {
    try {
      textarea.focus({ preventScroll: true });
    } catch {
      textarea.focus();
    }
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    copied = document.execCommand?.('copy') === true;
  } finally {
    textarea.remove();
    try {
      activeElement?.focus?.({ preventScroll: true });
    } catch {
      activeElement?.focus?.();
    }
  }
  if (!copied) throw new Error('copy_failed');
}

export async function copyMusicLink(videoId) {
  const link = musicLinkFromVideoId(videoId);
  if (!link) throw new Error('missing_music_link');

  // pointerup의 사용자 제스처가 살아 있는 동안 동기식 복사를 먼저 시도한다.
  // 비동기 Clipboard API 실패를 기다린 뒤 실행하면 모바일에서 권한이 만료될 수 있다.
  try {
    copyWithTextarea(link);
    return link;
  } catch {
    // execCommand를 지원하지 않는 최신 브라우저에서는 Clipboard API로 시도한다.
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(link);
    return link;
  }

  throw new Error('copy_failed');
}
