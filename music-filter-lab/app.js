'use strict';

// 서버 같은-오리진에서 서빙되므로 상대경로로 호출한다(CORS 없음).
// 인증은 사장님 앱과 같은 오리진의 localStorage 'token'을 재사용한다.
const API_BASE = '/api/v1';
const $ = (id) => document.getElementById(id);

function currentToken() {
  const manual = $('token').value.trim();
  return manual || localStorage.getItem('token') || '';
}

function refreshAuthState() {
  const el = $('authState');
  const hasSession = Boolean(localStorage.getItem('token'));
  const hasManual = Boolean($('token').value.trim());
  if (hasManual) {
    el.textContent = '수동 입력 토큰 사용 중';
    el.className = 'auth-state auth-state--ok';
  } else if (hasSession) {
    el.textContent = '사장님 로그인 세션 사용 중 (같은 브라우저)';
    el.className = 'auth-state auth-state--ok';
  } else {
    el.textContent = '로그인 세션 없음 — 사장님 앱에서 로그인하거나 아래에 토큰을 입력하세요.';
    el.className = 'auth-state auth-state--warn';
  }
}

async function api(method, path, body) {
  const token = currentToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function loadModels() {
  const { ok, data } = await api('GET', '/cafes/me/music-filter/models');
  const ids = ok && Array.isArray(data.models) ? data.models : [];
  if (ids.length) {
    $('modelList').innerHTML = ids.map((id) => `<option value="${id}"></option>`).join('');
    $('modelCount').textContent = `(${ids.length}개 · 클릭해서 선택/검색)`;
  } else {
    $('modelCount').textContent = '(목록을 불러오지 못함 · 직접 입력 가능)';
  }
}

function showResult({ decision, confidence, reason, model, track }) {
  $('resultPanel').hidden = false;
  const accept = decision === 'accept';
  const verdict = $('verdict');
  verdict.textContent = accept ? '✅ 수락 (accept)' : '⛔ 거절 (reject)';
  verdict.className = `verdict verdict--${accept ? 'accept' : 'reject'}`;
  $('reasonOut').textContent = reason || '—';
  $('trackOut').textContent = track ? `${track.title || '?'}${track.channelTitle ? ' · ' + track.channelTitle : ''}` : '—';
  $('modelOut').textContent = model || '—';
  $('confidenceOut').textContent = confidence == null ? '—' : Number(confidence).toFixed(2);
}

$('run').addEventListener('click', async () => {
  const url = $('url').value.trim();
  if (!url) { alert('음악 링크를 입력하세요.'); return; }
  if (!currentToken()) { alert('사장님 앱에서 먼저 로그인하거나 토큰을 입력하세요.'); return; }

  const button = $('run');
  button.disabled = true;
  button.textContent = '판단 중…';
  try {
    const { ok, status, data } = await api('POST', '/cafes/me/music-filter/test', {
      url,
      prompt: $('cafePrompt').value,
      model: $('model').value.trim() || undefined,
    });

    if (ok) {
      showResult(data);
    } else if (status === 503) {
      // fail-closed: 서버가 판단하지 못하면 안전을 위해 거절 처리된다.
      showResult({
        decision: 'reject',
        confidence: null,
        reason: `AI가 판단하지 못해 안전을 위해 자동 거절 (${data.errorCode || 'LLM 오류'})`,
        model: '—',
        track: null,
      });
    } else if (status === 401) {
      alert('인증 실패 — 로그인 세션이 만료되었거나 토큰이 올바르지 않습니다.');
    } else {
      alert(data.error || `요청 실패 (HTTP ${status})`);
    }
  } catch (error) {
    alert(`요청 중 오류: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = '필터 판단 실행';
  }
});

$('token').addEventListener('input', refreshAuthState);
refreshAuthState();
loadModels();
