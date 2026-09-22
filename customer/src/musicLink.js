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
  // iOS Safari는 readOnly 입력에서 선택 범위를 만들지 못해 execCommand가 false를 낸다.
  // readOnly를 두지 않고 contentEditable을 켜는 조합이 iOS에서 통한다. 화면 밖으로
  // 멀리 밀어낸 요소도 선택이 무시되므로 보이지 않는 1px로 화면 안에 둔다.
  textarea.contentEditable = 'true';
  textarea.readOnly = false;
  textarea.tabIndex = -1;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;';
  document.body.appendChild(textarea);
  const selection = window.getSelection?.();
  let copied;
  try {
    try {
      textarea.focus({ preventScroll: true });
    } catch {
      textarea.focus();
    }
    // setSelectionRange만으로는 iOS에서 선택이 잡히지 않아 Selection API를 함께 쓴다.
    if (selection && document.createRange) {
      const range = document.createRange();
      range.selectNodeContents(textarea);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    textarea.select?.();
    textarea.setSelectionRange?.(0, text.length);
    copied = document.execCommand?.('copy') === true;
  } finally {
    // 선택을 남기면 iOS에서 하이라이트가 화면에 보인다.
    selection?.removeAllRanges?.();
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
