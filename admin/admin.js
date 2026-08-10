// 운영자 토큰은 sessionStorage에 둔다 — 탭을 닫으면 사라지므로 공용 PC에
// 남지 않는다. 전체 카페 데이터 접근 권한이라 localStorage보다 보수적으로.
const TOKEN_KEY = 'cf_admin_token';
const STATUS_LABEL = { active: '사용 중', today: '오늘 사용', dormant: '휴면', never: '미사용' };
const STATUS_COLOR = { active: '#4ade80', today: '#facc15', dormant: '#f87171', never: '#6b7280' };

let cafes = [];
let filter = 'all';
let sortKey = 'created_at';
let view = 'list';
let map = null;
let markers = null;

const $ = (s) => document.querySelector(s);
const token = () => sessionStorage.getItem(TOKEN_KEY);

async function api(method, path, body) {
  const res = await fetch(`/api/v1/admin${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401 || res.status === 403) { logout(); throw new Error('인증 만료'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `오류 (${res.status})`);
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
  } catch (e) { err.textContent = e.message; }
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
      : b.today_unique_visitors - a.today_unique_visitors
  ));
}

function renderSummary() {
  const live = cafes.filter((c) => c.status === 'active' && !c.is_suspended).length;
  const reach = cafes.reduce((s, c) => s + (c.is_suspended ? 0 : c.today_unique_visitors), 0);
  const never = cafes.filter((c) => c.status === 'never' && !c.is_suspended).length;
  $('#summary').innerHTML = `
    <span>카페 <b>${cafes.length}</b></span>
    <span>사용 중 <b>${live}</b></span>
    <span>오늘 도달 <b>${reach}</b></span>
    <span>미사용 <b>${never}</b></span>`;
}

function renderList() {
  const list = visible();
  $('#empty').classList.toggle('hidden', list.length > 0);
  $('#rows').innerHTML = list.map((c) => `
    <tr class="${c.is_suspended ? 'susp' : ''}">
      <td><span class="dot s-${c.status}"></span>${STATUS_LABEL[c.status]}</td>
      <td>
        <div class="name">${esc(c.name)}${c.is_suspended ? '<span class="badge">정지</span>' : ''}</div>
        <div class="sub">/${esc(c.slug)} · ${esc(c.owner_email || '—')}</div>
      </td>
      <td class="sub">${esc([c.region, c.district, c.dong].filter(Boolean).join(' ') || '미등록')}</td>
      <td class="num">${c.today_unique_visitors}</td>
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
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
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
      오늘 도달 ${c.today_unique_visitors} · 신청 ${c.today_requests}`).addTo(markers);
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
  if (view === 'list') renderList(); else renderMap();
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
  const s = e.target.closest('[data-suspend]');
  const d = e.target.closest('[data-del]');
  try {
    if (s) {
      await api('PUT', `/cafes/${s.dataset.suspend}/suspend`, { is_suspended: s.dataset.val === 'true' });
      await load();
    } else if (d) {
      const cafe = cafes.find((c) => c.id === d.dataset.del);
      const typed = prompt(`삭제하면 방문·신청 기록까지 모두 사라지며 되돌릴 수 없습니다.\n확인하려면 카페명을 입력하세요:\n\n${cafe.name}`);
      if (typed !== cafe.name) return;
      await api('DELETE', `/cafes/${d.dataset.del}`);
      await load();
    }
  } catch (err) { alert(err.message); }
});

$('#loginBtn').addEventListener('click', login);
$('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

if (token()) start().catch(() => logout());
