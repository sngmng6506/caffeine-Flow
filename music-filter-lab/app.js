'use strict';

// 서버 같은-오리진에서 서빙되므로 상대경로로 호출한다(CORS 없음).
// 운영자 콘솔과 같은 탭의 sessionStorage 관리자 토큰만 사용한다.
const API_BASE = '/api/v1';
const TOKEN_KEY = 'cf_admin_token';
const $ = (id) => document.getElementById(id);

function currentToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
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
  const { ok, status, data } = await api('GET', '/admin/music-filter/models');
  if (status === 401 || status === 403) {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.replace('/admin');
    return;
  }
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
  if (!currentToken()) { window.location.replace('/admin'); return; }

  const button = $('run');
  button.disabled = true;
  button.textContent = '판단 중…';
  try {
    const { ok, status, data } = await api('POST', '/admin/music-filter/test', {
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
      sessionStorage.removeItem(TOKEN_KEY);
      alert('관리자 로그인이 만료되었습니다. 다시 로그인해주세요.');
      window.location.replace('/admin');
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

if (!currentToken()) {
  window.location.replace('/admin');
} else {
  loadModels();
}
