import { useEffect, useRef, useState } from 'react';

const DEFAULT_RATIO = 0.42;
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

function clampRatio(value) {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

export default function usePanelDivider() {
  const [panelRatio, setPanelRatio] = useState(() => {
    const saved = Number.parseFloat(localStorage.getItem('cf_panel_ratio'));
    return Number.isFinite(saved) ? clampRatio(saved) : DEFAULT_RATIO;
  });
  const draggingRef = useRef(false);
  const listenersRef = useRef(null);

  function stopDragging() {
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (wasDragging) window.electronAPI?.dividerDragEnd?.();
    if (listenersRef.current) {
      window.removeEventListener('mousemove', listenersRef.current.onMove);
      window.removeEventListener('mouseup', listenersRef.current.onUp);
      listenersRef.current = null;
    }
  }

  useEffect(() => {
    window.electronAPI?.setPanelRatio(panelRatio);
    return stopDragging;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDividerMouseDown(event) {
    event.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.electronAPI?.dividerDragStart?.();

    const onMove = (moveEvent) => {
      if (!draggingRef.current) return;
      const ratio = clampRatio(moveEvent.clientX / window.innerWidth);
      setPanelRatio(ratio);
      localStorage.setItem('cf_panel_ratio', String(ratio));
      window.electronAPI?.setPanelRatio(ratio);
    };
    const onUp = () => stopDragging();
    listenersRef.current = { onMove, onUp };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return { panelRatio, handleDividerMouseDown };
}
