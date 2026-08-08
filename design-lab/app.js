const NS = 'http://www.w3.org/2000/svg';

const COLORS = {
  acid: '#F3FF00',
  pink: '#FF3CAB',
  warm: '#FF9D45',
  ink: '#070807',
};

function polar(cx, cy, radius, angle) {
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  };
}

function seededSize(index, state, energy) {
  const wave = Math.sin(index * 1.83 + (state === 'playing' ? 1.1 : .3));
  const base = 2.7 + (wave + 1) * 1.4;
  return base + energy * .018;
}

function colorAt(index, count) {
  const t = index / Math.max(1, count - 1);
  if (t < .35) return COLORS.acid;
  if (t < .58) return COLORS.warm;
  if (t < .84) return COLORS.pink;
  return COLORS.acid;
}

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function buildMark({ state = 'idle', speed = 46, energy = 72, minimal = false } = {}) {
  const svg = svgEl('svg', { viewBox: '0 0 120 120', class: `flow-mark ${state}`, role: 'img' });
  svg.style.setProperty('--flow-speed', `${Math.max(2.8, 9 - speed * .06)}s`);

  const defs = svgEl('defs');
  const glow = svgEl('filter', { id: `glow-${Math.random().toString(36).slice(2)}`, x: '-80%', y: '-80%', width: '260%', height: '260%' });
  glow.append(svgEl('feGaussianBlur', { stdDeviation: minimal ? '0.4' : '1.7', result: 'blur' }));
  const merge = svgEl('feMerge');
  merge.append(svgEl('feMergeNode', { in: 'blur' }), svgEl('feMergeNode', { in: 'SourceGraphic' }));
  glow.append(merge);
  defs.append(glow);
  svg.append(defs);

  svg.append(svgEl('circle', { cx: '60', cy: '60', r: minimal ? '13' : '12.5', fill: COLORS.acid, class: 'core' }));

  const count = minimal ? 8 : 18;
  const radius = minimal ? 40 : 42;
  const ring = svgEl('g', { class: 'ring' });
  const gapStart = state === 'idle' ? 14 : 13;

  for (let i = 0; i < count; i += 1) {
    if (!minimal && (i === gapStart || i === gapStart + 1)) continue;
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / count;
    const p = polar(60, 60, radius, angle);
    const r = minimal ? 2.5 : seededSize(i, state, energy);
    const orb = svgEl('circle', {
      cx: p.x.toFixed(2),
      cy: p.y.toFixed(2),
      r: r.toFixed(2),
      fill: colorAt(i, count),
      class: 'orb',
      style: `--i:${i}`,
    });
    ring.append(orb);
  }

  if (!minimal) {
    const accent = svgEl('path', {
      d: 'M 21 79 A 46 46 0 0 1 15.5 67',
      fill: 'none',
      stroke: COLORS.pink,
      'stroke-width': state === 'playing' ? '5.2' : '4.4',
      'stroke-linecap': 'round',
      opacity: state === 'idle' ? '.58' : '1',
    });
    ring.append(accent);
  }

  svg.append(ring);

  if (state === 'request' && !minimal) {
    const requestP = polar(60, 60, 51, -.25);
    svg.append(svgEl('circle', {
      cx: requestP.x.toFixed(2),
      cy: requestP.y.toFixed(2),
      r: '5.5',
      fill: COLORS.pink,
      class: 'request-orb',
    }));
  }

  if (state === 'spread' && !minimal) {
    [50, 55].forEach((r, idx) => {
      svg.append(svgEl('circle', {
        cx: '60', cy: '60', r: String(r), fill: 'none',
        stroke: idx ? COLORS.pink : COLORS.acid,
        'stroke-width': '.6', opacity: '.18',
      }));
    });
  }

  return svg;
}

function mountMark(container, options) {
  container.replaceChildren(buildMark(options));
}

function renderStaticMarks() {
  document.querySelectorAll('[data-state]').forEach((el) => {
    const minimal = el.dataset.minimal === 'true';
    mountMark(el, { state: el.dataset.state, speed: 46, energy: 68, minimal });
  });
}

const hero = document.querySelector('#heroMark');
const stateSelect = document.querySelector('#stateSelect');
const speedRange = document.querySelector('#speedRange');
const energyRange = document.querySelector('#energyRange');
const speedValue = document.querySelector('#speedValue');
const energyValue = document.querySelector('#energyValue');
const burstButton = document.querySelector('#burstButton');

function renderHero(overrideState) {
  mountMark(hero, {
    state: overrideState || stateSelect.value,
    speed: Number(speedRange.value),
    energy: Number(energyRange.value),
  });
}

[stateSelect, speedRange, energyRange].forEach((input) => {
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
