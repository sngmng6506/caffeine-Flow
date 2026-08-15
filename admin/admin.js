// 운영자 토큰은 sessionStorage에 둔다 — 탭을 닫으면 사라지므로 공용 PC에
// 남지 않는다. 전체 카페 데이터 접근 권한이라 localStorage보다 보수적으로.
const TOKEN_KEY = 'cf_admin_token';
const STATUS_LABEL = { active: '사용 중', today: '오늘 사용', dormant: '휴면', never: '미사용' };
const STATUS_COLOR = { active: '#16a34a', today: '#d97706', dormant: '#dc2626', never: '#9ca3af' };

let cafes = [];
let filter = 'all';
let sortKey = 'created_at';
let view = 'list';
let map = null;
let markers = null;
let loginRetryTimer = null;
let statsCafeId = null;

const $ = (s) => document.querySelector(s);
const token = () => sessionStorage.getItem(TOKEN_KEY);

const deleteDialog = document.createElement('dialog');
deleteDialog.className = 'delete-modal';
deleteDialog.innerHTML = `
  <form method=dialog class=delete-modal__panel>
    <h2>정말 카페를 삭제할까요?</h2>
    <p>방문·신청·프롬프트 이력을 포함한 모든 데이터가 삭제되며 되돌릴 수 없습니다.</p>
    <label for=deleteCafeName>계속하려면 <b class=delete-modal__name></b>을 입력하세요.</label>
    <input id=deleteCafeName autocomplete=off />
    <div class=delete-modal__actions>
      <button class=act value=cancel>취소</button>
      <button class='act danger delete-modal__confirm' value=confirm disabled>삭제</button>
    </div>
  </form>`;
document.body.appendChild(deleteDialog);

let deleteTarget = null;
const deleteNameInput = deleteDialog.querySelector('input');
const deleteConfirm = deleteDialog.querySelector('.delete-modal__confirm');

function openDeleteDialog(cafe) {
  deleteTarget = cafe;
  deleteDialog.querySelector('.delete-modal__name').textContent = cafe.name;
  deleteNameInput.value = '';
  deleteConfirm.disabled = true;
  deleteDialog.showModal();
  deleteNameInput.focus();
}

deleteNameInput.addEventListener('input', () => {
  deleteConfirm.disabled = deleteNameInput.value !== deleteTarget?.name;
});

deleteDialog.addEventListener('close', () => {
  deleteTarget = null;
});

deleteDialog.querySelector('form').addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'confirm') return;
  event.preventDefault();
  if (!deleteTarget || deleteNameInput.value !== deleteTarget.name) return;
  deleteConfirm.disabled = true;
  try {
    await api('DELETE', `/cafes/${deleteTarget.id}`);
    deleteDialog.close();
    await load();
  } catch (error) {
    deleteConfirm.disabled = false;
    alert(error.message);
  }
});

async function api(method, path, body) {
  const res = await fetch(`/api/v1/admin${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if ((res.status === 401 || res.status === 403) && path !== '/login') {
    logout();
    throw new Error('인증이 만료되었습니다');
  }
  if (!res.ok) {
    const error = new Error(data.error || `오류 (${res.status})`);
    error.retryAfterSeconds = Number(data.retry_after_seconds) || 0;
    throw error;
  }
  return data;
}

function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

async function login() {
  const err = $('#loginErr');
  err.textContent = '';
  try {
    const { token: t } = await api('POST', '/login', { password: $('#pw').value });
    sessionStorage.setItem(TOKEN_KEY, t);
    $('#pw').value = '';
    start();
  } catch (e) {
    if (e.retryAfterSeconds > 0) startLoginRetryCountdown(e.retryAfterSeconds);
    else err.textContent = e.message;
  }
}

function startLoginRetryCountdown(seconds) {
  const button = $('#loginBtn');
  const err = $('#loginErr');
  let remaining = Math.max(1, Math.ceil(seconds));

  clearInterval(loginRetryTimer);
  button.disabled = true;

  const renderCountdown = () => {
    if (remaining <= 0) {
      clearInterval(loginRetryTimer);
      loginRetryTimer = null;
      button.disabled = false;
      err.textContent = '';
      return;
    }
    err.textContent = `${remaining}초 후 다시 시도할 수 있습니다`;
    remaining -= 1;
  };

  renderCountdown();
  loginRetryTimer = setInterval(renderCountdown, 1000);
}

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' });
}

// 마지막 사용 시각은 절대시각보다 "얼마나 지났나"가 판단에 직결됨
function fmtAgo(v) {
  if (!v) return '없음';
  const min = Math.floor((Date.now() - new Date(v).getTime()) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

function visible() {
  let list = cafes.filter((c) => {
    if (filter === 'active') return c.status === 'active' && !c.is_suspended;
    if (filter === 'never') return c.status === 'never' && !c.is_suspended;
    if (filter === 'suspended') return c.is_suspended;
    return true;
  });
  return list.sort((a, b) => (
    sortKey === 'created_at'
      ? new Date(b.created_at) - new Date(a.created_at)
      : b.today_unique_browsers - a.today_unique_browsers
  ));
}

function renderSummary() {
  const live = cafes.filter((c) => c.status === 'active' && !c.is_suspended).length;
  const reach = cafes.reduce((s, c) => s + (c.is_suspended ? 0 : c.today_unique_browsers), 0);
  const never = cafes.filter((c) => c.status === 'never' && !c.is_suspended).length;
  $('#summary').innerHTML = `
    <span>카페 <b>${cafes.length}</b></span>
    <span>사용 중 <b>${live}</b></span>
    <span>오늘 QR 접속 <b>${reach}</b></span>
    <span>미사용 <b>${never}</b></span>`;
}

function renderList() {
  const list = visible();
  $('#empty').classList.toggle('hidden', list.length > 0);
  $('#rows').innerHTML = list.map((c) => `
    <tr class="${c.is_suspended ? 'susp' : ''}">
      <td><span class="dot s-${c.status}"></span>${STATUS_LABEL[c.status]}</td>
      <td>
        <button class="name name-link" data-stats="${c.id}">${esc(c.name)}</button>${c.is_suspended ? '<span class="badge">정지</span>' : ''}
        <div class="sub">/${esc(c.slug)} · ${esc(c.owner_email || '—')}</div>
      </td>
      <td class="sub">${esc([c.region, c.district, c.dong].filter(Boolean).join(' ') || '미등록')}</td>
      <td class="num">${c.today_unique_browsers}</td>
      <td class="num">${c.today_requests}</td>
      <td class="sub">${fmtAgo(c.last_heartbeat_at)}</td>
      <td class="sub">${fmtDate(c.created_at)}</td>
      <td style="white-space:nowrap">
        <button class="act" data-suspend="${c.id}" data-val="${!c.is_suspended}">${c.is_suspended ? '해제' : '정지'}</button>
        <button class="act danger" data-del="${c.id}">삭제</button>
      </td>
    </tr>`).join('');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}

function renderMap() {
  if (!map) {
    map = L.map('map').setView([36.5, 127.8], 7); // 남한 전체
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19,
    }).addTo(map);
    markers = L.layerGroup().addTo(map);
  }
  markers.clearLayers();
  const pts = visible().filter((c) => c.latitude && c.longitude);
  pts.forEach((c) => {
    L.circleMarker([+c.latitude, +c.longitude], {
      radius: 8, color: STATUS_COLOR[c.status], fillColor: STATUS_COLOR[c.status],
      fillOpacity: c.is_suspended ? 0.15 : 0.7, weight: 2,
    }).bindPopup(`
      <b>${esc(c.name)}</b><br>${STATUS_LABEL[c.status]}${c.is_suspended ? ' · 정지됨' : ''}<br>
      오늘 익명 브라우저 ${c.today_unique_browsers} · 신청 ${c.today_requests}`).addTo(markers);
  });
  if (pts.length) {
    map.fitBounds(L.latLngBounds(pts.map((c) => [+c.latitude, +c.longitude])).pad(0.2));
  }
  setTimeout(() => map.invalidateSize(), 0); // hidden 상태에서 초기화된 경우 타일 깨짐 방지
}

function render() {
  renderSummary();
  $('#listView').classList.toggle('hidden', view !== 'list');
  $('#mapView').classList.toggle('hidden', view !== 'map');
  $('#statsView').classList.toggle('hidden', view !== 'stats');
  if (view === 'list') renderList();
  if (view === 'map') renderMap();
}

function metric(label, value, sub = '') {
  return `<div class="metric"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

function renderPattern(items, labelKey, formatLabel) {
  const visibleItems = items.filter((item) => item.count > 0);
  if (!visibleItems.length) return '<div class="stats-empty">아직 집계된 신청이 없습니다</div>';
  const max = Math.max(...visibleItems.map((item) => item.count), 1);
  return `<div class="pattern-list">${visibleItems.map((item) => `
    <div class="pattern-row">
      <span>${formatLabel(item[labelKey])}</span>
      <div class="pattern-track"><i style="width:${Math.max(4, Math.round((item.count / max) * 100))}%"></i></div>
      <b>${item.count}</b>
    </div>`).join('')}</div>`;
}

function fmtDateTime(value) {
  if (!value) return '기록 없음';
  return new Date(value).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function renderMusicFilterAudit(audit) {
  const statusLabel = {
    accepted: '승인',
    rejected: '거절',
    error_rejected: '오류 거절',
  };
  const currentPrompt = audit.current.prompt || '설정된 매장 분위기 설명이 없습니다.';
  const history = audit.prompt_history.length
    ? audit.prompt_history.map((item) => `
        <li>
          <div><b>${item.enabled ? '필터 켬' : '필터 끔'}</b><span>${item.record_type === 'baseline' ? '감사 기록 도입 시점' : fmtDateTime(item.recorded_at)}</span></div>
          <p>${esc(item.prompt || '매장 분위기 설명 없음')}</p>
        </li>`).join('')
    : '<li class=stats-empty>저장된 변경 이력이 없습니다</li>';
  const decisions = audit.decisions.length
    ? audit.decisions.map((item) => `
        <article class=audit-decision>
          <div class=audit-decision-head>
            <div><b>${esc(item.title)}</b><span>${esc(item.channel_title || item.platform)}</span></div>
            <span class='decision-status d-${item.filter_status}'>${statusLabel[item.filter_status] || esc(item.filter_status)}</span>
          </div>
          <dl>
            <div><dt>판단 시각</dt><dd>${fmtDateTime(item.filter_checked_at)}</dd></div>
            <div><dt>판단 사유</dt><dd>${esc(item.filter_reason || '사유 기록 없음')}</dd></div>
            <div><dt>사용 모델</dt><dd>${esc(item.filter_model || '기록 없음')}</dd></div>
          </dl>
          <details>
            <summary>판단 당시 프롬프트</summary>
            <pre>${esc(item.filter_prompt_snapshot || '기록 없음 — 감사 기능 도입 전 판단입니다.')}</pre>
          </details>
        </article>`).join('')
    : '<div class=stats-empty>AI 판단 이력이 없습니다</div>';

  return `
    <section class=stats-section>
      <h3>AI 프롬프트 모니터링</h3>
      <div class=current-prompt-head><b>현재 설정</b><span>${audit.current.enabled ? '필터 켬' : '필터 끔'}</span></div>
      <pre class=current-prompt>${esc(currentPrompt)}</pre>
      <div class=audit-columns>
        <div><h4>설정 변경 이력 <small>최근 50건</small></h4><ol class=prompt-history>${history}</ol></div>
        <div><h4>AI 승인·거절 이력 <small>최근 50건</small></h4><div class=decision-list>${decisions}</div></div>
      </div>
    </section>`;
}

function renderCafeStats(data, audit) {
  const { today, totals, hourly, weekday, musicFilter } = data;
  const pct = (value) => `${Math.round((value || 0) * 1000) / 10}%`;
  const topSongs = totals.topSongs.length
    ? `<ol class="top-songs">${totals.topSongs.map((song) => `
        <li><div><b>${esc(song.title)}</b><span>${esc(song.channel_title || '—')}</span></div><strong>${song.count}회</strong></li>`).join('')}</ol>`
    : '<div class="stats-empty">아직 재생된 곡이 없습니다</div>';
  const rejections = musicFilter.recentRejections.length
    ? `<div class="rejection-list">${musicFilter.recentRejections.map((item) => `
        <div><b>${esc(item.title)}</b><span>${esc(item.filterReason || '거절 사유 없음')}</span></div>`).join('')}</div>`
    : '<div class="stats-empty">최근 거절된 곡이 없습니다</div>';

  $('#statsTitle').textContent = `${data.cafe.name} 통계`;
  $('#statsContent').innerHTML = `
    ${renderMusicFilterAudit(audit)}
    <section class="stats-section">
      <h3>오늘</h3>
      <div class="metric-grid">
        ${metric('신청', today.total)}
        ${metric('재생', today.played)}
        ${metric('스킵', today.skipped)}
        ${metric('누적 신청', totals.total)}
      </div>
    </section>
    <div class="stats-columns">
      <section class="stats-section"><h3>시간대별 신청 <small>최근 30일</small></h3>${renderPattern(hourly, 'hour', (hour) => `${hour}시`)}</section>
      <section class="stats-section"><h3>요일별 신청 <small>최근 30일</small></h3>${renderPattern(weekday, 'day', (day) => `${day}요일`)}</section>
    </div>
    <section class="stats-section">
      <h3>AI 필터 <small>최근 7일</small></h3>
      <div class="metric-grid">
        ${metric('처리', musicFilter.processed, `미적용 ${musicFilter.skipped}건`)}
        ${metric('통과', musicFilter.accepted, pct(musicFilter.acceptRate))}
        ${metric('거절', musicFilter.rejected, pct(musicFilter.rejectRate))}
        ${metric('오류 거절', musicFilter.errorRejected, pct(musicFilter.errorRate))}
      </div>
      <h4>최근 거절 사유</h4>
      ${rejections}
    </section>
    <section class="stats-section"><h3>인기곡 TOP 10 <small>누적 재생 기준</small></h3>${topSongs}</section>`;
}

async function openCafeStats(cafeId) {
  statsCafeId = cafeId;
  view = 'stats';
  $('#statsTitle').textContent = '카페 통계';
  $('#statsContent').innerHTML = '<div class="stats-empty">불러오는 중...</div>';
  document.querySelectorAll('.chip[data-view]').forEach((button) => button.classList.remove('on'));
  render();
  try {
    const [data, audit] = await Promise.all([
      api('GET', `/cafes/${cafeId}/stats`),
      api('GET', `/cafes/${cafeId}/music-filter-audit`),
    ]);
    if (statsCafeId === cafeId) renderCafeStats(data, audit);
  } catch (error) {
    if (statsCafeId === cafeId) $('#statsContent').innerHTML = `<div class="stats-empty error-text">${esc(error.message)}</div>`;
  }
}

async function load() {
  cafes = await api('GET', '/cafes');
  render();
}

async function start() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await load();
}

// 툴바 — 같은 그룹 안에서만 on 토글
document.querySelector('.toolbar')?.addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  const group = b.dataset.filter ? 'filter' : b.dataset.sort ? 'sort' : b.dataset.view ? 'view' : null;
  if (!group) return;
  document.querySelectorAll(`.chip[data-${group}]`).forEach((x) => x.classList.remove('on'));
  b.classList.add('on');
  if (group === 'filter') filter = b.dataset.filter;
  if (group === 'sort') sortKey = b.dataset.sort;
  if (group === 'view') view = b.dataset.view;
  render();
});

$('#refresh').addEventListener('click', () => load().catch((e) => alert(e.message)));

// 행 액션 — 삭제는 CASCADE로 통계까지 사라지므로 카페명 입력으로 한 번 더 확인
$('#rows').addEventListener('click', async (e) => {
  const stats = e.target.closest('[data-stats]');
  const s = e.target.closest('[data-suspend]');
  const d = e.target.closest('[data-del]');
  try {
    if (stats) {
      await openCafeStats(stats.dataset.stats);
    } else if (s) {
      await api('PUT', `/cafes/${s.dataset.suspend}/suspend`, { is_suspended: s.dataset.val === 'true' });
      await load();
    } else if (d) {
      const cafe = cafes.find((c) => c.id === d.dataset.del);
      if (cafe) openDeleteDialog(cafe);
    }
  } catch (err) { alert(err.message); }
});

$('#statsBack').addEventListener('click', () => {
  statsCafeId = null;
  view = 'list';
  document.querySelectorAll('.chip[data-view]').forEach((button) => button.classList.toggle('on', button.dataset.view === 'list'));
  render();
});

$('#loginBtn').addEventListener('click', login);
$('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

if (token()) start().catch(() => logout());
