const MIN_PANEL_RATIO = 0.15;
const MAX_PANEL_RATIO = 0.85;
const COLLAPSED_PANEL_WIDTH = 48;

function clampPanelRatio(value) {
  return Math.min(MAX_PANEL_RATIO, Math.max(MIN_PANEL_RATIO, value));
}

function calculatePanelLayout(width, height, leftRatio, collapsed) {
  const safeWidth = Math.max(0, Math.floor(width));
  const safeHeight = Math.max(0, Math.floor(height));
  const leftWidth = collapsed
    ? Math.min(COLLAPSED_PANEL_WIDTH, safeWidth)
    : Math.floor(safeWidth * clampPanelRatio(leftRatio));

  return {
    leftWidth,
    browserViewBounds: {
      x: leftWidth,
      y: 0,
      width: safeWidth - leftWidth,
      height: safeHeight,
    },
  };
}

module.exports = {
  COLLAPSED_PANEL_WIDTH,
  calculatePanelLayout,
  clampPanelRatio,
};
