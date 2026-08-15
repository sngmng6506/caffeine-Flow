import { describe, expect, it } from 'vitest';
import panelLayoutModule from '../../owner/electron/panel-layout.js';

const { COLLAPSED_PANEL_WIDTH, calculatePanelLayout, clampPanelRatio } = panelLayoutModule;

describe('Electron owner panel layout', () => {
  it('펼친 상태에서는 저장된 비율로 BrowserView 경계를 계산한다', () => {
    expect(calculatePanelLayout(1200, 800, 0.42, false)).toEqual({
      leftWidth: 504,
      browserViewBounds: { x: 504, y: 0, width: 696, height: 800 },
    });
  });

  it('접힌 상태에서는 비율과 무관하게 48px 레일을 남긴다', () => {
    expect(calculatePanelLayout(1200, 800, 0.85, true)).toEqual({
      leftWidth: COLLAPSED_PANEL_WIDTH,
      browserViewBounds: { x: 48, y: 0, width: 1152, height: 800 },
    });
  });

  it('펼친 비율은 기존 최소·최대 범위를 유지한다', () => {
    expect(clampPanelRatio(0)).toBe(0.15);
    expect(clampPanelRatio(1)).toBe(0.85);
  });
});
