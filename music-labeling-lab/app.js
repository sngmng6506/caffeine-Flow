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

const RIGHTS_LABELS = Object.freeze({
  owned: '직접 소유',
  licensed: '이용 허가',
  public_domain: '퍼블릭 도메인',
  other_authorized: '기타 명시적 허가',
  platform_stream: '플랫폼 스트림',
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

// 3단 Audio LLM 스위치. 서버에 저장되므로 워커를 다시 띄우지 않아도 다음 곡부터
// 반영된다. 실패하면 화면 값을 서버 값으로 되돌려 실제 상태와 어긋나지 않게 한다.
async function loadAudioSettings() {
  const toggle = document.getElementById('audioLlmEnabled');
  const { ok, data } = await api('GET', '/admin/audio-settings');
  if (!ok) return;
  toggle.checked = data.audio_llm_enabled;
  toggle.disabled = false;
}

async function saveAudioSettings(event) {
  const toggle = event.target;
  const wanted = toggle.checked;
  toggle.disabled = true;
  const { ok, data } = await api('PUT', '/admin/audio-settings', { audio_llm_enabled: wanted });
  toggle.checked = ok ? data.audio_llm_enabled : !wanted;
  toggle.disabled = false;
  $('message').hidden = false;
  $('message').textContent = ok
    ? `AI 음악 서술을 ${data.audio_llm_enabled ? '켰습니다' : '껐습니다'}. 다음 분석부터 적용됩니다.`
    : (data.error || 'AI 음악 서술 설정을 바꾸지 못했습니다.');
}

// 최신곡 수집 요청. 워커가 뒤에서 차트를 훑어 분석 큐를 채운다. 같은 소스의 요청이
// 이미 대기 중이면 서버가 그것을 그대로 돌려주므로 중복으로 쌓이지 않는다.
async function requestCollection() {
  const button = $('collectApple');
  button.disabled = true;
  const { ok, data } = await api('POST', '/admin/audio-discoveries',
    { source: $('collectSource').value, limit: 20 });
  button.disabled = false;
  $('message').hidden = false;
  if (!ok) {
    $('message').textContent = data.error || '최신곡 수집을 요청하지 못했습니다.';
    return;
  }
  $('message').textContent = data.already
    ? '이미 수집이 대기 중입니다. 끝나면 목록에 새 곡이 나타납니다.'
    : '최신곡 수집을 요청했습니다. 다음 구간부터 가져오며, 끝나면 새로 등록된 곡 수가 목록에 반영됩니다.';
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

function formatMetric(value, digits = 1, suffix = '') {
  return Number.isFinite(value) ? `${Number(value).toFixed(digits)}${suffix}` : '—';
}

function trackUrl(item) {
  if (item.platform === 'youtube') {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(item.video_id)}`;
  }
  return /^https?:\/\//.test(item.video_id || '') ? item.video_id : '';
}




function renderSummary() {
  $('totalCount').textContent = summary.total.toLocaleString('ko-KR');
  $('reviewedCount').textContent = summary.reviewed.toLocaleString('ko-KR');
  $('unreviewedCount').textContent = summary.unreviewed.toLocaleString('ko-KR');
}

// 3단 자유 서술을 보여준다. 사람이 읽고 곡과 맞는지 판단할 유일한 근거다.
function renderAutoDescription(item) {
  const target = $('autoDescription');
  const llm = item.audio_analysis?.maest_summary?.audio_llm;
  const genres = item.track_annotation?.genre_tags?.filter((tag) => tag !== 'unknown') || [];
  const head = genres.length ? `<p class='auto-genre'>자동 장르 · ${escapeHtml(genres.join(', '))}</p>` : '';
  if (!llm?.description) {
    target.innerHTML = `${head}<p class='auto-empty'>자동 서술이 없습니다. AI 음악 서술이 꺼져 있었거나 분석이 실패한 곡입니다.</p>`;
    return;
  }
  const line = (label, values) => (values?.length
    ? `<p><b>${label}</b> ${escapeHtml(values.join(', '))}</p>` : '');
  target.innerHTML = head
    + `<p class='auto-text'>${escapeHtml(llm.description)}</p>`
    + line('분위기', llm.mood) + line('악기', llm.instruments)
    + line('보컬', llm.vocal) + line('구성', llm.structure);
}

function resetForm(item) {
  const form = $('reviewForm');
  form.reset();
  const annotation = item.track_annotation;
  $('artistName').value = annotation?.artist_name || item.channel_title || '';
  $('artistConfirmed').checked = annotation?.artist_confirmed === true;
  const labelOrigin = annotation?.label_source === 'automatic' ? '자동 라벨' : annotation?.human_review_status === 'corrected' ? '사람 수정 라벨' : '사람 확인 라벨';
  $('existingLabelStatus').textContent = annotation
    ? `기존 곡 라벨 불러옴 · ${labelOrigin} · ${formatDateTime(annotation.updated_at)}`
    : '실제 아티스트를 확인해주세요.';
  $('existingLabelStatus').classList.toggle('is-loaded', Boolean(annotation));
  $('artistReferences').hidden = true;
  $('artistReferences').innerHTML = '';

  renderAutoDescription(item);
}

function renderAudioAnalysis(item) {
  const panel = $('audioAnalysis');
  const analysis = item.audio_analysis;
  panel.hidden = !analysis;
  if (!analysis) return;

  const maest = analysis.maest_summary;
  $('maestRaw').hidden = true;
  $('maestRaw').textContent = '';
  $('loadMaestRaw').hidden = !analysis.latest_run_id;
  $('loadMaestRaw').disabled = false;
  $('maestSummary').innerHTML = maest ? `
    <p>MAEST · ${escapeHtml(maest.segment_count)}개 구간 · 평균 기준 상위 스타일 (미보정 점수)</p>
    <table><thead><tr><th>스타일</th><th>평균</th><th>최댓값</th></tr></thead><tbody>
    ${maest.top_mean.map((v) => `<tr><td>${escapeHtml(v.label)}</td><td>${formatMetric(v.mean, 3)}</td><td>${formatMetric(v.max, 3)}</td></tr>`).join('')}
    </tbody></table><p>구간 최댓값 상위: ${maest.top_max.slice(0, 5).map((v) => `${escapeHtml(v.label)} ${formatMetric(v.max, 3)}`).join(' · ')}</p>
    <p>무드·보컬·악기: 이번 모델의 분석 대상 아님. 확인 버튼은 미확정 항목도 그대로 저장합니다.</p>` : '';
  const features = analysis.features || {};
  const suggestion = analysis.automatic_annotation || analysis.suggested_annotation || {};
  const suggestions = [
    suggestion.tempo_class ? LABELS.tempo_class[suggestion.tempo_class] : null,
    suggestion.rhythmic_character
      ? LABELS.rhythmic_character[suggestion.rhythmic_character]
      : null,
    ...(suggestion.mood_tags || []).map((tag) => LABELS.mood_tags[tag] || tag),
    LABELS.instrumentation_type[suggestion.instrumentation_type],
    LABELS.vocal_type[suggestion.vocal_type],
    ...(suggestion.genre_tags || []).map((tag) => LABELS.genre_tags[tag] || tag),
  ].filter(Boolean);

  $('analysisStatus').textContent = analysis.review_status === 'reviewed' ? '검수 완료' : '검수 필요';
  $('analysisStatus').className = `analysis-status analysis-status--${analysis.review_status}`;
  $('analysisBpm').textContent = formatMetric(features.bpm, 1);
  $('analysisKey').textContent = features.key
    ? `${features.key} ${features.scale === 'major' ? '장조' : features.scale === 'minor' ? '단조' : ''}`.trim()
    : '—';
  $('analysisDanceability').textContent = formatMetric(features.danceability, 2);
  $('analysisLoudness').textContent = formatMetric(features.loudness_db, 1, ' dB');
  $('analysisDynamic').textContent = formatMetric(features.dynamic_complexity, 2);
  $('analysisValence').textContent = formatMetric(features.valence, 2);
  $('analysisArousal').textContent = formatMetric(features.arousal, 2);
  $('analysisCentroid').textContent = formatMetric(features.spectral_centroid_hz, 0, ' Hz');
  $('analysisSuggestion').textContent = suggestions.length
    ? suggestions.join(' · ')
    : '자동 추천 없음 — 직접 듣고 선택';
  $('analysisProvenance').textContent = [
    `${analysis.model_name} ${analysis.model_version}`,
    RIGHTS_LABELS[analysis.rights_basis] || analysis.rights_basis,
    analysis.source_reference,
    formatDateTime(analysis.analyzed_at),
  ].filter(Boolean).join(' · ');
}

function renderItem() {
  renderSummary();
  const item = items[currentIndex];
  $('requeueAudio').disabled = !item || ['processing', 'queued', 'unsupported'].includes(item.job_status);
  $('renormalizeAudio').disabled = !item || item.job_status !== 'completed' || !item.audio_analysis?.latest_run_id;
  if (!item) {
    $('reviewCard').hidden = true;
    $('message').hidden = false;
    $('message').textContent = ['unreviewed', 'ready'].includes($('viewFilter').value)
      ? '현재 검토할 항목이 없습니다. 새로고침으로 분석 진행 상태를 확인하세요.'
      : '표시할 곡이 없습니다.';
    $('position').textContent = '0건';
    return;
  }

  const complete = item.track_annotation && item.track_annotation.human_review_status !== 'unreviewed' && (!item.audio_analysis || item.audio_analysis.review_status === 'reviewed');
  const url = trackUrl(item);
  $('message').hidden = true;
  $('reviewCard').hidden = false;
  $('position').textContent = `${currentOffset + currentIndex + 1}번째 · 현재 묶음 ${items.length}건`;
  $('cafeName').textContent = '전체 매장 신청곡 · 같은 곡은 한 번만 분석';
  $('trackTitle').textContent = item.title || '제목 없음';
  $('trackArtist').textContent = item.channel_title || '아티스트 정보 없음';
  $('platform').textContent = item.platform || '기록 없음';
  $('checkedAt').textContent = formatDateTime(item.audio_analysis?.analyzed_at || item.created_at);
  $('trackLink').href = url || '#';
  $('trackLink').hidden = !url;

  resetForm(item);
  renderAudioAnalysis(item);
  const states = { queued: '분석 대기', processing: '분석 중', completed: '자동 라벨링 완료', failed: '분석 실패 · 재시도 한도 초과', unsupported: 'Spotify 자동 분석 미지원' };
  $('jobStatus').textContent = `${states[item.job_status] || item.job_status}${item.error_code ? ` · ${item.error_code}` : ''}`;
  for (const id of ['verdictAccurate', 'verdictInaccurate', 'verdictUnclear']) {
    $(id).disabled = !item.track_annotation;
  }
  $('verdictAccurate').textContent = complete ? '확인됨 · 다음' : '맞음 · 다음';
  $('previousItem').disabled = currentIndex === 0 && currentOffset === 0;
  $('nextItem').disabled = currentIndex >= items.length - 1 && !hasMore;
}

async function loadPage(offset = 0) {
  $('reviewCard').hidden = true;
  $('message').hidden = false;
  $('message').textContent = '라벨링 목록을 불러오는 중…';
  const view = $('viewFilter').value;
  const { ok, data } = await api('GET', `/admin/audio-labels?view=${view}&offset=${offset}`);
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

// 서술이 곡과 맞는지만 답한다. 택소노미를 고르게 하면 판단이 어려워 아무거나 찍게
// 되고, 그렇게 만든 골드 라벨은 없느니만 못하다.
async function submitVerdict(verdict, buttonId) {
  const item = items[currentIndex];
  if (!item?.track_annotation) return;
  const button = $(buttonId);
  button.disabled = true;
  try {
    const { ok, data } = await api('PUT', `/admin/audio-labels/${item.id}/review`, {
      verdict,
      artist_confirmed: $('artistConfirmed').checked,
      annotation_revision: item.track_annotation.revision,
      audio_analysis_id: item.audio_analysis?.id || null,
      audio_analysis_revision: item.audio_analysis?.revision || null,
    });
    if (!ok) throw new Error(data.error || '검토를 저장하지 못했습니다');
    await advanceAfterReview();
  } catch (error) { alert(error.message); }
  finally { button.disabled = !items[currentIndex]?.track_annotation; }
}

$('verdictAccurate').addEventListener('click', () => submitVerdict('accurate', 'verdictAccurate'));
$('verdictInaccurate').addEventListener('click', () => submitVerdict('inaccurate', 'verdictInaccurate'));
$('verdictUnclear').addEventListener('click', () => submitVerdict('unclear', 'verdictUnclear'));
$('refreshQueue').addEventListener('click', () => loadPage(0));

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
    loadPage(['unreviewed', 'ready'].includes($('viewFilter').value) ? 0 : nextOffset);
  }
});

$('viewFilter').addEventListener('change', () => loadPage(0));

$('audioLlmEnabled').addEventListener('change', saveAudioSettings);
$('collectApple').addEventListener('click', requestCollection);

if (!currentToken()) {
  window.location.replace('/admin');
} else {
  loadPage();
  loadAudioSettings();
}

$('loadMaestRaw').addEventListener('click', async () => {
  const item = items[currentIndex];
  const runId = item?.audio_analysis?.latest_run_id;
  if (!runId) return;
  $('loadMaestRaw').disabled = true;
  try {
    const [raw, history] = await Promise.all([api('GET', `/admin/audio-runs/${runId}`), api('GET', `/admin/audio-labels/${item.id}/runs`)]);
    if (items[currentIndex]?.audio_analysis?.latest_run_id !== runId) return;
    $('maestRaw').hidden = false;
    $('maestRaw').textContent = raw.ok && history.ok
      ? JSON.stringify({ history: history.data, latest: raw.data }, null, 2)
      : '원본을 불러오지 못했습니다. 다시 시도해주세요.';
  } catch {
    if (items[currentIndex]?.audio_analysis?.latest_run_id === runId) {
      $('maestRaw').hidden = false;
      $('maestRaw').textContent = '원본을 불러오지 못했습니다. 다시 시도해주세요.';
    }
  } finally {
    if (items[currentIndex]?.audio_analysis?.latest_run_id === runId) $('loadMaestRaw').disabled = false;
  }
});

$('artistName').addEventListener('input', () => { $('artistConfirmed').checked = false; });
for (const [buttonId, action] of [['requeueAudio', 'requeue'], ['renormalizeAudio', 'renormalize']]) {
  $(buttonId).addEventListener('click', async () => {
    const item = items[currentIndex];
    if (!item) return;
    $(buttonId).disabled = true;
    try {
      const { ok, data } = await api('POST', `/admin/audio-labels/${item.id}/${action}`, {
        generation: item.generation, analysis_id: item.audio_analysis?.id,
        analysis_revision: item.audio_analysis?.revision,
      });
      if (!ok) throw new Error(data.error || '처리하지 못했습니다');
      await loadPage(currentOffset);
    } catch (error) { alert(error.message); renderItem(); }
  });
}
