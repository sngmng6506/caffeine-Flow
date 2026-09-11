'use strict';

const API_BASE = '/api/v1';
const TOKEN_KEY = 'cf_admin_token';
const PAGE_SIZE = 50;
const $ = (id) => document.getElementById(id);

// 자동 장르를 한국어로 보여줄 때만 쓴다. 사람이 고르는 선택지는 없다.
const GENRE_LABELS = Object.freeze({
  pop: '팝', ballad: '발라드', hiphop_rap: '힙합·랩', rnb_soul: 'R&B·소울',
  rock_metal: '록·메탈', electronic_dance: '전자음악·댄스', jazz: '재즈',
  classical: '클래식', acoustic_folk: '어쿠스틱·포크', ambient_lofi: '앰비언트·로파이',
  ost_instrumental: 'OST·연주', world_latin_reggae: '월드·라틴·레게',
  other: '기타', unknown: '잘 모르겠음',
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
  let data;
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
  const toggle = $('audioLlmEnabled');
  const { ok, data } = await api('GET', '/admin/audio-settings');
  if (!ok) return;
  toggle.checked = data.audio_llm_enabled;
  toggle.disabled = false;
  $('promptBody').value = data.audio_llm_prompt || '';
  $('promptVersion').textContent = data.audio_llm_prompt_version || '';
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

function promptNote(text) {
  $('promptMessage').textContent = text || '';
}

// 프롬프트를 고쳐도 이미 저장된 서술은 그대로다. 다음 분석부터 적용된다.
async function savePrompt() {
  const button = $('savePrompt');
  button.disabled = true;
  const { ok, data } = await api('PUT', '/admin/audio-settings', {
    audio_llm_enabled: $('audioLlmEnabled').checked,
    audio_llm_prompt: $('promptBody').value,
  });
  button.disabled = false;
  if (!ok) { promptNote(data.error || '프롬프트를 저장하지 못했습니다.'); return; }
  $('promptBody').value = data.audio_llm_prompt || '';
  $('promptVersion').textContent = data.audio_llm_prompt_version || '';
  promptNote(`저장했습니다. 다음 분석부터 적용됩니다 · ${data.audio_llm_prompt_version}`);
}

function resetPrompt() {
  $('promptBody').value = '';
  promptNote('비웠습니다. 저장하면 워커의 기본 문장으로 돌아갑니다.');
}

// 틀림으로 표시한 곡만 다시 큐에 넣는다. 프롬프트를 고친 뒤 쓰는 경로다.
async function requeueRejected() {
  const button = $('requeueRejected');
  button.disabled = true;
  try {
    const counted = await api('POST', '/admin/audio-labels/requeue-rejected', { dry_run: true });
    if (!counted.ok) { promptNote(counted.data.error || '대상을 세지 못했습니다.'); return; }
    if (!counted.data.eligible) { promptNote('재분석할 곡이 없습니다.'); return; }
    if (!window.confirm(`${counted.data.eligible}곡을 다시 분석합니다.\n`
      + '곡마다 오디오 구간을 외부 LLM에 다시 보내므로 요금이 듭니다. 계속할까요?')) {
      promptNote('재분석을 취소했습니다.');
      return;
    }
    const { ok, data } = await api('POST', '/admin/audio-labels/requeue-rejected');
    if (!ok) { promptNote(data.error || '재분석을 요청하지 못했습니다.'); return; }
    promptNote(`${data.requeued}곡을 재분석 큐에 넣었습니다. 워커가 순서대로 처리합니다.`);
    await loadPage(0);
  } finally { button.disabled = false; }
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




// 판정하면 그 곡이 조건에서 빠지는 보기. 앞에서부터 다시 읽어야 한다.
function isQueueView() {
  return ['unreviewed', 'ready', 'suspicious', 'inaccurate'].includes($('viewFilter').value);
}

function renderSummary() {
  $('totalCount').textContent = summary.total.toLocaleString('ko-KR');
  $('reviewedCount').textContent = summary.reviewed.toLocaleString('ko-KR');
  $('unreviewedCount').textContent = summary.unreviewed.toLocaleString('ko-KR');
}

function canReviewDescription(item) {
  return Boolean(item?.track_annotation && item?.audio_analysis?.maest_summary?.audio_llm?.description?.trim());
}

// 3단 자유 서술을 보여준다. 사람이 읽고 곡과 맞는지 판단할 유일한 근거다.
function renderAutoDescription(item) {
  const target = $('autoDescription');
  const llm = item.audio_analysis?.maest_summary?.audio_llm;
  const genres = (item.track_annotation?.genre_tags || [])
    .filter((tag) => tag !== 'unknown').map((tag) => GENRE_LABELS[tag] || tag);
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
  const annotation = item.track_annotation;
  $('artistConfirmed').checked = annotation?.artist_confirmed === true;
  const labelOrigin = annotation?.label_source === 'automatic' ? '자동 라벨' : annotation?.human_review_status === 'corrected' ? '사람 수정 라벨' : '사람 확인 라벨';
  $('existingLabelStatus').textContent = annotation
    ? `${labelOrigin} · ${formatDateTime(annotation.updated_at)}`
    : '아직 자동 라벨이 없습니다.';
  $('existingLabelStatus').classList.toggle('is-loaded', Boolean(annotation));

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
    <p>무드·보컬·악기는 이 모델의 분석 대상이 아닙니다.</p>` : '';
  const features = analysis.features || {};
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
    const emptyByView = {
      inaccurate: '틀림·애매로 판정한 곡이 없습니다.',
      suspicious: '판정할 서술이 있는 미검토 곡이 없습니다.',
    };
    $('message').textContent = isQueueView()
      ? (emptyByView[$('viewFilter').value]
        || '현재 검토할 항목이 없습니다. 새로고침으로 분석 진행 상태를 확인하세요.')
      : '표시할 곡이 없습니다.';
    $('position').textContent = '0건';
    return;
  }

  const complete = item.track_annotation && item.track_annotation.human_review_status !== 'unreviewed' && (!item.audio_analysis || item.audio_analysis.review_status === 'reviewed');
  const url = trackUrl(item);
  $('message').hidden = true;
  $('reviewCard').hidden = false;
  $('position').textContent = `${currentOffset + currentIndex + 1}번째 / 이번 묶음 ${items.length}건`;
  $('trackTitle').textContent = item.title || '제목 없음';
  const artist = item.track_annotation?.artist_name || item.channel_title;
  $('trackArtist').textContent = artist || '아티스트 정보 없음';
  // 수집한 이름과 저장된 이름이 다르면 다른 곡을 분석했을 수 있다.
  const collected = item.channel_title;
  $('artistFlag').innerHTML = collected && artist && collected !== artist
    ? `<span class='mismatch'>수집 이름 · ${escapeHtml(collected)}</span>` : '';
  // 왜 이 곡이 위로 왔는지. 정렬과 같은 규칙에서 서버가 만들어 보낸 것을 그대로 쓴다.
  const why = item.review_reasons || [];
  $('reviewReasons').hidden = why.length === 0;
  $('reviewReasons').innerHTML = why
    .map((reason) => `<span class='reason'>${escapeHtml(reason.text)}</span>`).join('');
  $('platform').textContent = `${item.platform || '플랫폼 미상'} · ${item.video_id || ''}`.trim();
  $('checkedAt').textContent = `등록 ${formatDateTime(item.created_at)}`;
  $('trackLink').href = url || '#';
  $('trackLink').hidden = !url;

  showAlert('');
  resetForm(item);
  renderAudioAnalysis(item);
  const states = { queued: '분석 대기', processing: '분석 중', completed: '자동 라벨링 완료', failed: '분석 실패 · 재시도 한도 초과', unsupported: 'Spotify 자동 분석 미지원' };
  const status = item.job_status === 'completed' && !item.error_code
    ? '' : `${states[item.job_status] || item.job_status}${item.error_code ? ` · ${item.error_code}` : ''}`;
  $('jobStatus').textContent = status;
  for (const id of ['verdictAccurate', 'verdictInaccurate']) {
    $(id).disabled = !canReviewDescription(item);
  }
  // 버튼 전체를 덮으면 <kbd>1</kbd> 단축키 표시가 함께 지워진다.
  $('verdictAccurate').querySelector('[data-verdict-label]').textContent = complete ? '확인됨' : '맞음';
  $('previousItem').disabled = currentIndex === 0 && currentOffset === 0;
  $('nextItem').disabled = currentIndex >= items.length - 1 && !hasMore;
}

async function loadPage(offset = 0) {
  $('promptPanel').hidden = $('viewFilter').value !== 'inaccurate';
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

const VERDICT_WORDS = Object.freeze({ accurate: '맞음', inaccurate: '틀림' });

// 저장됐다는 사실을 알리는 유일한 피드백이다. 목록이 갱신되는 것만으로는
// 눌렀는지 안 눌렀는지 알 수 없다(Nielsen #1 시스템 상태 가시성).
function showAlert(text) {
  $('barAlert').textContent = text || '';
}

function showStamp(verdict) {
  const stamp = $('verdictStamp');
  stamp.textContent = VERDICT_WORDS[verdict] || '저장';
  stamp.classList.remove('show');
  void stamp.offsetWidth;
  stamp.classList.add('show');
  // 동작을 줄인 환경에서는 애니메이션이 없어 스스로 사라지지 않는다.
  clearTimeout(showStamp.timer);
  showStamp.timer = setTimeout(() => stamp.classList.remove('show'), 700);
}

// 서술이 곡과 맞는지만 답한다. 택소노미를 고르게 하면 판단이 어려워 아무거나 찍게
// 되고, 그렇게 만든 골드 라벨은 없느니만 못하다.
async function submitVerdict(verdict, buttonId) {
  const item = items[currentIndex];
  if (!canReviewDescription(item)) return;
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
    showAlert('');
    showStamp(verdict);
    await advanceAfterReview();
  } catch (error) { showAlert(error.message); }
  finally { button.disabled = !canReviewDescription(items[currentIndex]); }
}

// 저장한 곡을 목록에서 걷어내고 다음 곡으로 넘어간다. 검토 대기 화면은 방금 저장한
// 곡이 조건에서 빠지므로 앞에서부터 다시 읽는다.
async function advanceAfterReview() {
  const index = currentIndex;
  const queueView = isQueueView();
  await loadPage(queueView ? 0 : currentOffset);
  if (!queueView) {
    currentIndex = Math.min(index + 1, Math.max(0, items.length - 1));
    renderItem();
  }
}

$('verdictAccurate').addEventListener('click', () => submitVerdict('accurate', 'verdictAccurate'));
$('verdictInaccurate').addEventListener('click', () => submitVerdict('inaccurate', 'verdictInaccurate'));
$('refreshQueue').addEventListener('click', () => loadPage(0));

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
    loadPage(isQueueView() ? 0 : nextOffset);
  }
});

$('viewFilter').addEventListener('change', () => loadPage(0));

// 반복 작업이라 손이 마우스와 키보드를 오가지 않게 한다. 글자를 입력하는 중이거나
// 목록·버튼에 포커스가 있을 때는 가로채지 않는다.
const SHORTCUTS = Object.freeze({
  1: () => submitVerdict('accurate', 'verdictAccurate'),
  2: () => submitVerdict('inaccurate', 'verdictInaccurate'),
  ArrowLeft: () => $('previousItem').click(),
  ArrowRight: () => $('nextItem').click(),
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = event.target?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || event.target?.isContentEditable) return;
  if (event.key === 'a' || event.key === 'A') {
    $('artistConfirmed').checked = !$('artistConfirmed').checked;
    event.preventDefault();
    return;
  }
  const run = SHORTCUTS[event.key];
  if (!run || $('reviewCard').hidden) return;
  // 판정 버튼이 꺼져 있으면(자동 라벨 없음) 단축키도 같이 막는다.
  if (['1', '2'].includes(event.key) && $('verdictAccurate').disabled) return;
  event.preventDefault();
  run();
});

$('audioLlmEnabled').addEventListener('change', saveAudioSettings);
$('collectApple').addEventListener('click', requestCollection);
$('savePrompt').addEventListener('click', savePrompt);
$('resetPrompt').addEventListener('click', resetPrompt);
$('requeueRejected').addEventListener('click', requeueRejected);

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
      showAlert('');
      await loadPage(currentOffset);
    } catch (error) { showAlert(error.message); renderItem(); }
  });
}
