'use strict';

const API_BASE = '/api/v1';
const TOKEN_KEY = 'cf_admin_token';
const PAGE_SIZE = 50;
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

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('ko-KR') : '기록 없음';
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

function resetForm(item) {
  const form = $('reviewForm');
  form.reset();
  const annotation = item.track_annotation;
  $('artistName').value = annotation?.artist_name || item.channel_title || '';
  $('existingLabelStatus').textContent = annotation
    ? `기존 곡 라벨 불러옴 · ${formatDateTime(annotation.updated_at)}`
    : '실제 아티스트를 확인해주세요.';
  $('existingLabelStatus').classList.toggle('is-loaded', Boolean(annotation));
  $('artistReferences').hidden = true;
  $('artistReferences').innerHTML = '';

  if (annotation) {
    setRadio('tempo_class', annotation.tempo_class);
    setChecks('mood_tags', annotation.mood_tags || []);
    setRadio('instrumentation_type', annotation.instrumentation_type);
    setRadio('rhythmic_character', annotation.rhythmic_character);
    setRadio('vocal_type', annotation.vocal_type);
    setChecks('genre_tags', annotation.genre_tags || []);
    form.elements.note.value = annotation.note || '';
    setRadio('usage_scope', annotation.usage_scope);
  }

  setRadio('human_decision', item.human_decision);
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
    if (!wasComplete) {
      summary.reviewed += 1;
      summary.unreviewed = Math.max(0, summary.unreviewed - 1);
    }
    renderItem();
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

$('findArtistLabels').addEventListener('click', loadArtistReferences);
$('previousItem').addEventListener('click', () => {
  if (currentIndex > 0) {
    currentIndex -= 1;
    renderItem();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (currentOffset >= PAGE_SIZE) {
    loadPage(Math.max(0, currentOffset - PAGE_SIZE));
  }
});

$('nextItem').addEventListener('click', () => {
  if (currentIndex < items.length - 1) {
    currentIndex += 1;
    renderItem();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (hasMore) {
    loadPage($('viewFilter').value === 'unreviewed' ? 0 : nextOffset);
  }
});

$('viewFilter').addEventListener('change', () => loadPage(0));

if (!currentToken()) {
  window.location.replace('/admin');
} else {
  loadPage();
}
