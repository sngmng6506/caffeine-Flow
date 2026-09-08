'use strict';

const API_BASE = '/api/v1';
const TOKEN_KEY = 'cf_admin_token';
const PAGE_SIZE = 50;
// 서버가 일괄 확정을 허용하는 문턱과 같다. 화면은 후보를 고를 때만 쓰고,
// 실제 자격은 서버가 저장된 분석으로 다시 판정한다.
const BULK_MIN_CONFIDENCE = 0.85;
const BULK_MAX_ITEMS = 50;

// 자동으로 채우는 칸. 배지와 프리필이 이 순서를 따른다.
const AUTO_FIELDS = Object.freeze([
  { field: 'tempo_class', kind: 'radio' },
  { field: 'mood_tags', kind: 'checks' },
  { field: 'instrumentation_type', kind: 'radio' },
  { field: 'rhythmic_character', kind: 'radio' },
  { field: 'vocal_type', kind: 'radio' },
  { field: 'genre_tags', kind: 'checks' },
]);

const FLAG_LABELS = Object.freeze({
  'conflict:mood': '분위기 판단이 서로 어긋납니다',
  'conflict:vocal_genre': '보컬 유형과 장르가 서로 어긋납니다',
});

const FIELD_NAMES = Object.freeze({
  tempo_class: '체감 템포',
  mood_tags: '주요 분위기',
  instrumentation_type: '사운드 구성',
  rhythmic_character: '리듬 특징',
  vocal_type: '보컬 유형',
  genre_tags: '장르',
});
const $ = (id) => document.getElementById(id);

const LABELS = Object.freeze({
  tempo_class: {
    very_slow: '매우 느림', slow: '느림', moderate: '보통', fast: '빠름',
    very_fast: '매우 빠름', unknown: '판단하기 어려움',
  },
  mood_tags: {
    peaceful: '평온·차분', joyful: '밝음·즐거움', tender: '따뜻함·부드러움',
    nostalgic: '몽환·향수', sad: '슬픔·우울', uplifting: '웅장·고양',
    tense: '긴장·어두움', aggressive: '공격적·강렬', quirky: '독특·장난스러움',
    unknown: '판단하기 어려움',
  },
  instrumentation_type: {
    acoustic: '어쿠스틱 중심', electronic: '전자음 중심', hybrid: '혼합',
    unknown: '판단하기 어려움',
  },
  rhythmic_character: {
    minimal: '리듬이 거의 없음', steady: '안정적인 리듬', danceable: '춤추기 좋은 리듬',
    heavy_beat: '강한 비트 중심', irregular: '불규칙·실험적', unknown: '판단하기 어려움',
  },
  vocal_type: {
    none: '목소리 없음', singing: '노래 위주', rap_spoken: '랩·말하기 위주',
    unknown: '판단하기 어려움',
  },
  genre_tags: {
    pop: '팝', ballad: '발라드', hiphop_rap: '힙합·랩', rnb_soul: 'R&B·소울',
    rock_metal: '록·메탈', electronic_dance: '전자음악·댄스', jazz: '재즈',
    classical: '클래식', acoustic_folk: '어쿠스틱·포크', ambient_lofi: '앰비언트·로파이',
    ost_instrumental: 'OST·연주', world_latin_reggae: '월드·라틴·레게',
    other: '기타', unknown: '잘 모르겠음',
  },
});

let items = [];
let currentIndex = 0;
let currentOffset = 0;
let nextOffset = null;
let hasMore = false;
let summary = { total: 0, reviewed: 0, unreviewed: 0 };

function currentToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

async function api(method, path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${currentToken()}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (response.status === 401 || response.status === 403) {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.replace('/admin');
  }
  return { ok: response.ok, status: response.status, data };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(String.fromCharCode(34), '&quot;')
    .replaceAll(String.fromCharCode(39), '&#039;');
}

// 목적격 조사는 앞 글자의 받침으로 정해진다. "장르을"처럼 어긋나면 눈에 걸린다.
function withObjectParticle(word) {
  const last = String(word).trim().slice(-1);
  const code = last.charCodeAt(0);
  const isHangulSyllable = code >= 0xac00 && code <= 0xd7a3;
  const hasFinalConsonant = isHangulSyllable && (code - 0xac00) % 28 !== 0;
  return `${word}${hasFinalConsonant ? '을' : '를'}`;
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('ko-KR') : '기록 없음';
}

function formatMetric(value, digits = 1, suffix = '') {
  return Number.isFinite(value) ? `${Number(value).toFixed(digits)}${suffix}` : '—';
}

function trackUrl(item) {
  if (item.platform === 'youtube') {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(item.video_id)}`;
  }
  return /^https?:\/\//.test(item.video_id || '') ? item.video_id : '';
}

function setRadio(name, value) {
  document.querySelectorAll(`input[type=radio][name=${name}]`).forEach((input) => {
    input.checked = input.value === value;
  });
}

function setChecks(name, values = []) {
  document.querySelectorAll(`input[type=checkbox][name=${name}]`).forEach((input) => {
    input.checked = values.includes(input.value);
  });
}

function selectedValues(form, name) {
  return new FormData(form).getAll(name);
}

function renderSummary() {
  $('totalCount').textContent = summary.total.toLocaleString('ko-KR');
  $('reviewedCount').textContent = summary.reviewed.toLocaleString('ko-KR');
  $('unreviewedCount').textContent = summary.unreviewed.toLocaleString('ko-KR');
}

// 자동 추천값을 폼에 채운다. 값이 있는 칸만 건드리고 나머지는 비워 둔다.
// 반환값은 실제로 채운 칸 목록이다.
function applySuggestion(suggestion) {
  const filled = [];
  if (!suggestion) return filled;
  for (const { field, kind } of AUTO_FIELDS) {
    const value = suggestion[field];
    if (kind === 'radio') {
      if (!value) continue;
      setRadio(field, value);
    } else {
      if (!Array.isArray(value) || value.length === 0) continue;
      setChecks(field, value);
    }
    filled.push(field);
  }
  return filled;
}

// 어느 칸이 자동으로 채워졌고 얼마나 확신하는지 각 항목 옆에 남긴다.
// 사람이 폼을 훑을 때 어디를 봐야 하는지가 여기서 정해진다.
function renderAutoBadges({ suggestion, filled, fromAnnotation }) {
  const confidence = suggestion?.confidence || {};
  const flags = new Set(suggestion?.review_flags || []);
  document.querySelectorAll('[data-auto-badge]').forEach((badge) => {
    const field = badge.dataset.autoBadge;
    badge.className = 'auto-badge';
    if (fromAnnotation) {
      badge.hidden = true;
      return;
    }
    if (!filled.includes(field)) {
      badge.hidden = false;
      badge.textContent = '직접 선택';
      badge.classList.add('auto-badge--missing');
      return;
    }
    const score = confidence[field];
    const needsCheck = flags.has(`low_confidence:${field}`);
    badge.hidden = false;
    badge.textContent = Number.isFinite(score)
      ? `자동 ${Math.round(score * 100)}%${needsCheck ? ' · 확인 필요' : ''}`
      : '자동';
    badge.classList.add(needsCheck ? 'auto-badge--check' : 'auto-badge--auto');
  });
}

function resetForm(item) {
  const form = $('reviewForm');
  form.reset();
  const annotation = item.track_annotation;
  const suggestion = item.audio_analysis?.suggested_annotation;
  $('artistName').value = annotation?.artist_name || item.channel_title || '';
  $('existingLabelStatus').textContent = annotation
    ? `기존 곡 라벨 불러옴 · ${formatDateTime(annotation.updated_at)}${annotation.confirmation_mode === 'bulk' ? ' · 일괄 확정' : ''}`
    : '실제 아티스트를 확인해주세요.';
  $('existingLabelStatus').classList.toggle('is-loaded', Boolean(annotation));
  $('artistReferences').hidden = true;
  $('artistReferences').innerHTML = '';

  let filled = [];
  if (annotation) {
    // 사람이 이미 고른 값이 자동 추천보다 우선한다.
    setRadio('tempo_class', annotation.tempo_class);
    setChecks('mood_tags', annotation.mood_tags || []);
    setRadio('instrumentation_type', annotation.instrumentation_type);
    setRadio('rhythmic_character', annotation.rhythmic_character);
    setRadio('vocal_type', annotation.vocal_type);
    setChecks('genre_tags', annotation.genre_tags || []);
    form.elements.note.value = annotation.note || '';
    setRadio('usage_scope', annotation.usage_scope);
  } else {
    filled = applySuggestion(suggestion);
  }

  renderAutoBadges({ suggestion, filled, fromAnnotation: Boolean(annotation) });
  setRadio('human_decision', item.human_decision);
}

function renderAudioAnalysis(item) {
  const panel = $('audioAnalysis');
  const analysis = item.audio_analysis;
  panel.hidden = !analysis;
  if (!analysis) return;

  const features = analysis.features || {};
  const suggestion = analysis.suggested_annotation || {};
  const suggestions = AUTO_FIELDS.flatMap(({ field, kind }) => {
    const value = suggestion[field];
    if (kind === 'checks') return (value || []).map((tag) => LABELS[field][tag] || tag);
    return value ? [LABELS[field][value] || value] : [];
  });

  $('analysisStatus').textContent = analysis.review_status === 'reviewed' ? '검수 완료' : '검수 필요';
  $('analysisStatus').className = `analysis-status analysis-status--${analysis.review_status}`;
  $('analysisBpm').textContent = formatMetric(features.bpm, 1);
  $('analysisKey').textContent = features.key
    ? `${features.key} ${features.scale === 'major' ? '장조' : features.scale === 'minor' ? '단조' : ''}`.trim()
    : '—';
  $('analysisDanceability').textContent = formatMetric(features.danceability, 2);
  $('analysisLoudness').textContent = formatMetric(features.loudness_db, 1, ' dB');
  $('analysisDynamic').textContent = formatMetric(features.dynamic_complexity, 2);
  $('analysisCentroid').textContent = formatMetric(features.spectral_centroid_hz, 0, ' Hz');
  const flags = suggestion.review_flags || [];
  const flagPanel = $('analysisFlags');
  flagPanel.hidden = flags.length === 0;
  flagPanel.textContent = flags.map((flag) => {
    if (FLAG_LABELS[flag]) return FLAG_LABELS[flag];
    const [kind, field] = flag.split(':');
    const name = FIELD_NAMES[field] || field;
    return kind === 'missing'
      ? `${withObjectParticle(name)} 자동으로 채우지 못했습니다`
      : `${name} 확신도가 낮습니다`;
  }).join(' · ');

  $('analysisSuggestion').textContent = suggestions.length
    ? suggestions.join(' · ')
    : '자동 추천 없음 — 직접 듣고 선택';
  $('applyAnalysisSuggestion').disabled = suggestions.length === 0;
  $('analysisProvenance').textContent = [
    `${analysis.model_name} ${analysis.model_version}`,
    formatDateTime(analysis.analyzed_at),
  ].filter(Boolean).join(' · ');
}

function renderItem() {
  renderSummary();
  const item = items[currentIndex];
  if (!item) {
    $('reviewCard').hidden = true;
    $('message').hidden = false;
    $('message').textContent = $('viewFilter').value === 'unreviewed'
      ? '남은 미완료 항목이 없습니다.'
      : '표시할 AI 판단 이력이 없습니다.';
    $('position').textContent = '0건';
    return;
  }

  const complete = Boolean(item.human_decision && item.track_annotation);
  const url = trackUrl(item);
  $('message').hidden = true;
  $('reviewCard').hidden = false;
  $('position').textContent = `${currentOffset + currentIndex + 1}번째 · 현재 묶음 ${items.length}건`;
  $('cafeName').textContent = item.cafe_name || '카페 정보 없음';
  $('trackTitle').textContent = item.title || '제목 없음';
  $('trackArtist').textContent = item.channel_title || '아티스트 정보 없음';
  $('platform').textContent = item.platform || '기록 없음';
  $('checkedAt').textContent = formatDateTime(item.filter_checked_at);
  $('policy').textContent = item.filter_prompt_snapshot || '기록 없음 — 감사 기능 도입 전 판단입니다.';
  $('trackLink').href = url || '#';
  $('trackLink').hidden = !url;

  resetForm(item);
  renderAudioAnalysis(item);
  $('aiDecision').textContent = `AI ${item.filter_status === 'accepted' ? '승인' : item.filter_status === 'rejected' ? '거절' : '오류 거절'}`;
  $('aiDecision').className = `decision decision--${item.filter_status}`;

  $('saveReview').textContent = complete ? '곡 라벨과 매장 판단 갱신' : '곡 라벨과 매장 판단 저장';
  $('previousItem').disabled = currentIndex === 0 && currentOffset === 0;
  $('nextItem').disabled = currentIndex >= items.length - 1 && !hasMore;
}

async function loadPage(offset = 0) {
  $('reviewCard').hidden = true;
  $('message').hidden = false;
  $('message').textContent = '라벨링 목록을 불러오는 중…';
  const view = $('viewFilter').value;
  const { ok, data } = await api('GET', `/admin/music-filter-reviews?view=${view}&offset=${offset}`);
  if (!ok) {
    $('message').textContent = data.error || '라벨링 목록을 불러오지 못했습니다.';
    return;
  }

  items = data.decisions || [];
  summary = data.summary || summary;
  currentOffset = data.offset || 0;
  currentIndex = 0;
  hasMore = Boolean(data.has_more);
  nextOffset = data.next_offset;
  renderItem();
}

function annotationSummary(annotation) {
  const moods = (annotation.mood_tags || []).map((value) => LABELS.mood_tags[value] || value).join(', ');
  const genres = (annotation.genre_tags || []).map((value) => LABELS.genre_tags[value] || value).join(', ');
  return [
    LABELS.tempo_class[annotation.tempo_class], moods,
    LABELS.instrumentation_type[annotation.instrumentation_type],
    LABELS.rhythmic_character[annotation.rhythmic_character],
    LABELS.vocal_type[annotation.vocal_type], genres,
  ].filter(Boolean).join(' · ');
}

async function loadArtistReferences() {
  const item = items[currentIndex];
  const artist = $('artistName').value.trim();
  if (!item || !artist) {
    alert('확인한 아티스트명을 먼저 입력해주세요.');
    return;
  }

  const targetId = item.id;
  const button = $('findArtistLabels');
  const container = $('artistReferences');
  button.disabled = true;
  button.textContent = '찾는 중…';
  try {
    const params = new URLSearchParams({ artist, platform: item.platform, track_key: item.video_id });
    const { ok, data } = await api('GET', `/admin/music-filter-artist-labels?${params}`);
    if (items[currentIndex]?.id !== targetId) return;
    container.hidden = false;
    if (!ok) {
      container.innerHTML = `<p>${escapeHtml(data.error || '같은 아티스트 라벨을 불러오지 못했습니다.')}</p>`;
      return;
    }
    if (!data.labels?.length) {
      container.innerHTML = '<p>저장된 다른 곡 라벨이 없습니다.</p>';
      return;
    }
    container.innerHTML = `
      <h4>같은 아티스트의 다른 곡 참고 <small>현재 곡의 확정 정보는 아닙니다</small></h4>
      ${data.labels.map((label) => `
        <article>
          <b>${escapeHtml(label.title)}</b>
          <p>${escapeHtml(annotationSummary(label))}</p>
          ${label.note ? `<small>${escapeHtml(label.note)}</small>` : ''}
        </article>`).join('')}`;
  } finally {
    button.disabled = false;
    button.textContent = '같은 아티스트 참고';
  }
}

$('reviewForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const item = items[currentIndex];
  if (!item) return;
  const formElement = event.currentTarget;
  const moodTags = selectedValues(formElement, 'mood_tags');
  const genreTags = selectedValues(formElement, 'genre_tags');
  if (moodTags.length < 1 || moodTags.length > 2) {
    alert('주요 분위기를 1~2개 선택해주세요.');
    return;
  }
  if (genreTags.length > 2) {
    alert('장르는 최대 2개까지 선택할 수 있습니다.');
    return;
  }

  const form = new FormData(formElement);
  const decision = form.get('human_decision');
  const reasonCode = decision === 'accept'
    ? 'policy_match'
    : decision === 'reject' ? 'policy_mismatch' : 'metadata_insufficient';
  const wasComplete = Boolean(item.human_decision && item.track_annotation);
  const button = $('saveReview');
  button.disabled = true;
  button.textContent = '저장 중…';
  try {
    const { ok, data } = await api(
      'PUT',
      `/admin/cafes/${item.cafe_id}/music-filter-audit/${item.id}/review`,
      {
        human_decision: decision,
        human_reason_code: reasonCode,
        metadata_sufficient: item.metadata_sufficient ?? null,
        audio_analysis_id: item.audio_analysis?.id || null,
        track_annotation: {
          artist_name: form.get('artist_name'),
          track_version: item.track_annotation?.track_version || 'unknown',
          tempo_class: form.get('tempo_class'),
          mood_tags: moodTags,
          instrumentation_type: form.get('instrumentation_type'),
          rhythmic_character: form.get('rhythmic_character'),
          vocal_type: form.get('vocal_type'),
          genre_tags: genreTags,
          note: form.get('note')?.trim() || null,
          usage_scope: form.get('usage_scope'),
        },
      },
    );
    if (!ok) throw new Error(data.error || '라벨을 저장하지 못했습니다.');

    Object.assign(item, data);
    item.track_annotation = data.track_annotation;
    if (item.audio_analysis) {
      item.audio_analysis.review_status = 'reviewed';
      item.audio_analysis.reviewed_at = new Date().toISOString();
    }
    if (!wasComplete) {
      summary.reviewed += 1;
      summary.unreviewed = Math.max(0, summary.unreviewed - 1);
    }
    renderItem();
    // 미검수 계열 뷰에서는 저장한 곡이 목록에서 빠질 대상이다. 손이 멈추지
    // 않도록 바로 다음 곡으로 넘어간다.
    if (['unreviewed', 'ambiguous'].includes($('viewFilter').value)) goToNext();
  } catch (error) {
    alert(error.message);
    button.textContent = wasComplete ? '곡 라벨과 매장 판단 갱신' : '곡 라벨과 매장 판단 저장';
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('[data-max-choices]').forEach((group) => {
  group.addEventListener('change', (event) => {
    const changed = event.target.closest('input[type=checkbox]');
    if (!changed) return;
    const inputs = [...group.querySelectorAll('input[type=checkbox]')];
    if (changed.checked && changed.value === 'unknown') {
      inputs.forEach((input) => { if (input !== changed) input.checked = false; });
      return;
    }
    if (changed.checked) {
      const unknown = inputs.find((input) => input.value === 'unknown');
      if (unknown) unknown.checked = false;
    }
    const checked = inputs.filter((input) => input.checked);
    if (checked.length > Number(group.dataset.maxChoices)) {
      changed.checked = false;
      alert(`최대 ${group.dataset.maxChoices}개까지 선택할 수 있습니다.`);
    }
  });
});

// --- 확실한 곡 일괄 확정 ---
//
// 여기서 고르는 건 후보일 뿐이다. 무엇이 저장될지는 서버가 저장된 분석에서
// 다시 판정하므로, 화면 조건이 느슨해도 잘못된 라벨이 들어가지 않는다.
function bulkCandidates() {
  return items.filter((item) => {
    if (item.track_annotation) return false;
    if (!item.channel_title) return false;
    const analysis = item.audio_analysis;
    if (!analysis || analysis.review_status !== 'pending') return false;
    const suggestion = analysis.suggested_annotation || {};
    if ((suggestion.review_flags || []).length > 0) return false;
    return Number(suggestion.min_confidence) >= BULK_MIN_CONFIDENCE;
  }).slice(0, BULK_MAX_ITEMS);
}

function renderBulkPanel() {
  const candidates = bulkCandidates();
  const list = $('bulkList');
  $('bulkConfirm').disabled = candidates.length === 0;
  if (!candidates.length) {
    list.innerHTML = '<li class="bulk-empty">이 묶음에는 자동으로 확정할 만큼 확실한 곡이 없습니다.</li>';
    return;
  }
  list.innerHTML = candidates.map((item) => {
    const suggestion = item.audio_analysis.suggested_annotation || {};
    const percent = Math.round(Number(suggestion.min_confidence) * 100);
    return `
      <li>
        <label>
          <input type='checkbox' value='${escapeHtml(item.id)}' checked />
          <span class='bulk-title'>${escapeHtml(item.title || '제목 없음')}</span>
          <span class='bulk-score'>최저 ${percent}%</span>
          <span class='bulk-artist'>${escapeHtml(item.channel_title)}</span>
          <span class='bulk-summary'>${escapeHtml(annotationSummary(suggestion))}</span>
        </label>
      </li>`;
  }).join('');
}

async function confirmSelectedInBulk() {
  const selected = [...$('bulkList').querySelectorAll('input[type=checkbox]:checked')]
    .map((input) => items.find((item) => item.id === input.value))
    .filter(Boolean);
  if (!selected.length) {
    alert('확정할 곡을 선택해주세요.');
    return;
  }

  const button = $('bulkConfirm');
  button.disabled = true;
  button.textContent = '확정 중…';
  try {
    const { ok, data } = await api('POST', '/admin/music-filter-reviews/bulk-confirm', {
      items: selected.map((item) => ({ cafe_id: item.cafe_id, recommendation_id: item.id })),
    });
    if (!ok) throw new Error(data.error || '일괄 확정에 실패했습니다.');

    const result = $('bulkResult');
    result.hidden = false;
    result.textContent = data.skipped?.length
      ? `${data.confirmed.length}건 확정 · ${data.skipped.length}건은 자격을 갖추지 못해 건너뜀`
      : `${data.confirmed.length}건 확정`;
    // 서버가 실제로 무엇을 저장했는지 다시 읽는다. 화면에서 추측하지 않는다.
    await loadPage(0);
    renderBulkPanel();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = '선택한 곡 확정';
  }
}

$('toggleBulk').addEventListener('click', () => {
  const panel = $('bulkPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderBulkPanel();
});

$('bulkSelectAll').addEventListener('click', () => {
  const inputs = [...$('bulkList').querySelectorAll('input[type=checkbox]')];
  const turnOn = inputs.some((input) => !input.checked);
  inputs.forEach((input) => { input.checked = turnOn; });
});

$('bulkConfirm').addEventListener('click', confirmSelectedInBulk);

$('findArtistLabels').addEventListener('click', loadArtistReferences);
$('applyAnalysisSuggestion').addEventListener('click', () => {
  applySuggestion(items[currentIndex]?.audio_analysis?.suggested_annotation);
});
function goToPrevious() {
  if (currentIndex > 0) {
    currentIndex -= 1;
    renderItem();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (currentOffset >= PAGE_SIZE) {
    loadPage(Math.max(0, currentOffset - PAGE_SIZE));
  }
}

function goToNext() {
  if (currentIndex < items.length - 1) {
    currentIndex += 1;
    renderItem();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (hasMore) {
    // 미검수 계열은 저장할수록 목록이 줄어드니 처음부터 다시 읽는다.
    loadPage(['unreviewed', 'ambiguous'].includes($('viewFilter').value) ? 0 : nextOffset);
  }
}

$('previousItem').addEventListener('click', goToPrevious);
$('nextItem').addEventListener('click', goToNext);
$('viewFilter').addEventListener('change', () => {
  $('bulkPanel').hidden = true;
  loadPage(0);
});

// 손을 폼에서 떼지 않고 훑기 위한 단축키. 입력 중에는 가로채지 않는다.
document.addEventListener('keydown', (event) => {
  if (event.altKey || event.metaKey) return;
  const typing = event.target.closest('input, textarea, select');

  if (event.key === 'Enter' && event.ctrlKey) {
    event.preventDefault();
    $('reviewForm').requestSubmit();
    return;
  }
  if (typing || event.ctrlKey) return;

  const key = event.key.toLowerCase();
  if (key === 'j') { event.preventDefault(); goToNext(); }
  if (key === 'k') { event.preventDefault(); goToPrevious(); }
  if (key === 'o') {
    const url = trackUrl(items[currentIndex] || {});
    if (url) window.open(url, '_blank', 'noopener');
  }
});

if (!currentToken()) {
  window.location.replace('/admin');
} else {
  loadPage();
}
