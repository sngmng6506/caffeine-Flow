const NS = 'http://www.w3.org/2000/svg';

const COLORS = {
  acid: '#F3FF00',
  pink: '#FF3CAB',
  warm: '#FF9D45',
  ink: '#070807',
};

const WAVE_HEIGHTS = {
  balanced: [24, 48, 34, 68, 40, 54, 28],
  mirror: [20, 34, 50, 64, 76, 64, 50, 34, 20],
  steps: [18, 26, 36, 48, 64, 52, 38, 24],
};

const CF_BARS = [
  { x: 22, y: 28, width: 8, height: 64 },
  { x: 30, y: 28, width: 24, height: 8 },
  { x: 30, y: 84, width: 24, height: 8 },
  { x: 66, y: 28, width: 8, height: 64 },
  { x: 74, y: 28, width: 26, height: 8 },
  { x: 74, y: 52, width: 20, height: 8 },
];

function waveformBars(variant, minimal, energy) {
  if (variant === 'cf' && !minimal) return CF_BARS;

  const heights = minimal ? [24, 44, 66, 44, 24] : WAVE_HEIGHTS[variant] || WAVE_HEIGHTS.balanced;
  const width = minimal ? 9 : variant === 'mirror' ? 6 : 7;
  const gap = minimal ? 5 : variant === 'mirror' ? 4 : 5;
  const totalWidth = heights.length * width + (heights.length - 1) * gap;
  const startX = (120 - totalWidth) / 2;
  const energyScale = minimal ? 1 : .72 + energy * .004;

  return heights.map((height, index) => {
    const scaledHeight = height * energyScale;
    return {
      x: startX + index * (width + gap),
      y: 60 - scaledHeight / 2,
      width,
      height: scaledHeight,
    };
  });
}

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function buildMark({ state = 'idle', speed = 46, energy = 72, minimal = false, variant = 'balanced' } = {}) {
  const svg = svgEl('svg', { viewBox: '0 0 120 120', class: `flow-mark ${state}`, role: 'img' });
  svg.style.setProperty('--wave-speed', `${Math.max(.5, 1.35 - speed * .008)}s`);

  svg.dataset.variant = variant;
  const defs = svgEl('defs');
  const gradientId = `wave-${Math.random().toString(36).slice(2)}`;
  const gradient = svgEl('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.append(
    svgEl('stop', { offset: '0', 'stop-color': COLORS.acid }),
    svgEl('stop', { offset: '.55', 'stop-color': COLORS.warm }),
    svgEl('stop', { offset: '1', 'stop-color': COLORS.pink })
  );
  defs.append(gradient);
  svg.append(defs);

  const waveform = svgEl('g', { class: 'waveform' });
  waveformBars(variant, minimal, energy).forEach((bar, index) => {
    waveform.append(svgEl('rect', {
      x: bar.x.toFixed(2),
      y: bar.y.toFixed(2),
      width: bar.width.toFixed(2),
      height: bar.height.toFixed(2),
      rx: minimal ? '3' : '4',
      fill: `url(#${gradientId})`,
      class: 'wave-bar',
      style: `--i:${index}`,
    }));
  });
  svg.append(waveform);

  return svg;
}

function mountMark(container, options) {
  container.replaceChildren(buildMark(options));
}

function renderStaticMarks() {
  document.querySelectorAll('[data-state]').forEach((el) => {
    const minimal = el.dataset.minimal === 'true';
    mountMark(el, { state: el.dataset.state, speed: 46, energy: 68, minimal, variant: el.dataset.variant });
  });
}

const hero = document.querySelector('#heroMark');
const stateSelect = document.querySelector('#stateSelect');
const variantSelect = document.querySelector('#variantSelect');
const speedRange = document.querySelector('#speedRange');
const energyRange = document.querySelector('#energyRange');
const speedValue = document.querySelector('#speedValue');
const energyValue = document.querySelector('#energyValue');
const burstButton = document.querySelector('#burstButton');

function renderHero(overrideState) {
  mountMark(hero, {
    state: overrideState || stateSelect.value,
    variant: variantSelect.value,
    speed: Number(speedRange.value),
    energy: Number(energyRange.value),
  });
}

[stateSelect, variantSelect, speedRange, energyRange].forEach((input) => {
  input.addEventListener('input', () => {
    speedValue.value = speedRange.value;
    energyValue.value = energyRange.value;
    renderHero();
  });
});

burstButton.addEventListener('click', () => {
  renderHero('request');
  window.setTimeout(() => renderHero(), 1100);
});

renderStaticMarks();
renderHero();
