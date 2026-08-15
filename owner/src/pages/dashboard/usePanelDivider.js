import { useEffect, useState } from 'react';

const DEFAULT_RATIO = 0.42;
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

function clampRatio(value) {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

export default function usePanelDivider() {
  const supportsPanelCollapse = window.electronAPI?.supportsPanelCollapse === true;
  const [panelRatio, setPanelRatio] = useState(() => {
    const saved = Number.parseFloat(localStorage.getItem('cf_panel_ratio'));
    return Number.isFinite(saved) ? clampRatio(saved) : DEFAULT_RATIO;
  });
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  useEffect(() => {
    window.electronAPI?.setPanelRatio(panelRatio);
    if (supportsPanelCollapse) window.electronAPI?.setPanelCollapsed(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function collapsePanel() {
    if (!supportsPanelCollapse) return;
    setIsPanelCollapsed(true);
    window.electronAPI?.setPanelCollapsed(true);
  }

  function expandPanel() {
    if (!supportsPanelCollapse) return;
    setIsPanelCollapsed(false);
    window.electronAPI?.setPanelRatio(panelRatio);
    window.electronAPI?.setPanelCollapsed(false);
  }

  return {
    panelRatio,
    isPanelCollapsed,
    supportsPanelCollapse,
    collapsePanel,
    expandPanel,
  };
}
