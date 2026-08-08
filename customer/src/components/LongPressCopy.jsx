import { Children, cloneElement, useEffect, useRef } from 'react';
import { copyMusicLink } from '../musicLink';

const LONG_PRESS_MS = 550;
const MOVE_TOLERANCE_PX = 12;
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [role=button]';

export default function LongPressCopy({ videoId, onResult, children }) {
  const timerRef = useRef(null);
  const resetTimerRef = useRef(null);
  const pressRef = useRef(null);
  const armedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const child = Children.only(children);

  function clearPress() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pressRef.current = null;
    armedRef.current = false;
  }

  function isEligibleTarget(event) {
    const interactive = event.target.closest?.(INTERACTIVE_SELECTOR);
    return !interactive || interactive === event.currentTarget;
  }

  function handlePointerDown(event) {
    child.props.onPointerDown?.(event);
    if (event.defaultPrevented || !event.isPrimary || event.button !== 0 || !isEligibleTarget(event)) return;

    clearPress();
    pressRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    timerRef.current = setTimeout(() => {
      if (!pressRef.current) return;
      armedRef.current = true;
      navigator.vibrate?.(20);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event) {
    child.props.onPointerMove?.(event);
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE_PX) clearPress();
  }

  async function handlePointerEnd(event) {
    child.props.onPointerUp?.(event);
    const shouldCopy = armedRef.current && pressRef.current?.pointerId === event.pointerId;
    if (!shouldCopy) {
      clearPress();
      return;
    }

    suppressClickRef.current = true;
    resetTimerRef.current = setTimeout(() => { suppressClickRef.current = false; }, 800);
    try {
      await copyMusicLink(videoId);
      onResult?.({ type: 'success', message: '곡 링크를 복사했어요.' });
    } catch {
      onResult?.({ type: 'error', message: '링크를 복사하지 못했어요. 잠시 후 다시 시도해 주세요.' });
    }
    clearPress();
  }

  function handlePointerCancel(event) {
    child.props.onPointerCancel?.(event);
    clearPress();
  }

  function handleClickCapture(event) {
    child.props.onClickCapture?.(event);
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }

  function handleContextMenu(event) {
    child.props.onContextMenu?.(event);
    if (isEligibleTarget(event)) event.preventDefault();
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  return cloneElement(child, {
    className: [child.props.className, 'copyable-track'].filter(Boolean).join(' '),
    title: child.props.title || '길게 눌러 링크 복사',
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
    onPointerCancel: handlePointerCancel,
    onClickCapture: handleClickCapture,
    onContextMenu: handleContextMenu,
  });
}
