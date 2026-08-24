'use strict';

const API_BASE = '/api/v1';
const TOKEN_KEY = 'cf_admin_token';
const PAGE_SIZE = 50;
const $ = (id) => document.getElementById(id);

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

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('ko-KR') : '기록 없음';
}

function trackUrl(item) {
  if (item.platform === 'youtube') {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(item.video_id)}`;
  }
  return /^https?:\/\//.test(item.video_id || '') ? item.video_id : '';
}

function setSelectValue(name, value) {
  document.querySelector(`[name=${name}]`).value = value == null ? '' : String(value);
}

function renderSummary() {
  $('totalCount').textContent = summary.total.toLocaleString('ko-KR');
  $('reviewedCount').textContent = summary.reviewed.toLocaleString('ko-KR');
  $('unreviewedCount').textContent = summary.unreviewed.toLocaleString('ko-KR');
}

function renderItem() {
  renderSummary();
  const item = items[currentIndex];
  if (!item) {
    $('reviewCard').hidden = true;
    $('message').hidden = false;
    $('message').textContent = $('viewFilter').value === 'unreviewed'
      ? '남은 미검수 항목이 없습니다.'
      : '표시할 AI 판단 이력이 없습니다.';
    $('position').textContent = '0건';
    return;
  }

  const reviewed = Boolean(item.human_decision);
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

  $('blindNote').hidden = reviewed;
  $('aiResult').hidden = !reviewed;
  $('aiDecision').textContent = `AI ${item.filter_status === 'accepted' ? '승인' : item.filter_status === 'rejected' ? '거절' : '오류 거절'}`;
  $('aiDecision').className = `decision decision--${item.filter_status}`;
  $('aiReason').textContent = item.filter_reason || '사유 기록 없음';
  $('aiConfidence').textContent = item.filter_confidence == null
    ? '기록 없음'
    : Number(item.filter_confidence).toFixed(2);
  $('aiModel').textContent = item.filter_model || '기록 없음';
  $('aiErrorRow').hidden = !item.filter_error_code;
  $('aiError').textContent = item.filter_error_code || '';

  setSelectValue('human_decision', item.human_decision);
  setSelectValue('human_reason_code', item.human_reason_code);
  setSelectValue('metadata_sufficient', item.metadata_sufficient);
  $('saveReview').textContent = reviewed ? '검수 갱신' : '검수 저장';
  $('previousItem').disabled = currentIndex === 0 && currentOffset === 0;
  $('nextItem').disabled = currentIndex >= items.length - 1 && !hasMore;
}

async function loadPage(offset = 0) {
  $('reviewCard').hidden = true;
  $('message').hidden = false;
  $('message').textContent = '검수 목록을 불러오는 중…';
  const view = $('viewFilter').value;
  const { ok, data } = await api('GET', `/admin/music-filter-reviews?view=${view}&offset=${offset}`);
  if (!ok) {
    $('message').textContent = data.error || '검수 목록을 불러오지 못했습니다.';
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

$('reviewForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const item = items[currentIndex];
  if (!item) return;

  const form = new FormData(event.currentTarget);
  const button = $('saveReview');
  const wasReviewed = Boolean(item.human_decision);
  button.disabled = true;
  button.textContent = '저장 중…';
  try {
    const { ok, data } = await api(
      'PUT',
      `/admin/cafes/${item.cafe_id}/music-filter-audit/${item.id}/review`,
      {
        human_decision: form.get('human_decision'),
        human_reason_code: form.get('human_reason_code'),
        metadata_sufficient: form.get('metadata_sufficient') === 'true',
      },
    );
    if (!ok) throw new Error(data.error || '검수를 저장하지 못했습니다.');

    Object.assign(item, data);
    if (!wasReviewed) {
      summary.reviewed += 1;
      summary.unreviewed = Math.max(0, summary.unreviewed - 1);
    }
    renderItem();
  } catch (error) {
    alert(error.message);
    button.textContent = wasReviewed ? '검수 갱신' : '검수 저장';
  } finally {
    button.disabled = false;
  }
});

$('previousItem').addEventListener('click', () => {
  if (currentIndex > 0) {
    currentIndex -= 1;
    renderItem();
  } else if (currentOffset >= PAGE_SIZE) {
    loadPage(Math.max(0, currentOffset - PAGE_SIZE));
  }
});

$('nextItem').addEventListener('click', () => {
  if (currentIndex < items.length - 1) {
    currentIndex += 1;
    renderItem();
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
