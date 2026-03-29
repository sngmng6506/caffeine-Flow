const dot        = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const serverInput = document.getElementById('server-url');
const tokenInput  = document.getElementById('token');
const saveBtn    = document.getElementById('save-btn');
const savedMsg   = document.getElementById('saved-msg');

// 저장된 설정 불러오기
chrome.storage.local.get(
  { serverUrl: 'http://localhost:3000', token: 'cafe-secret-2024' },
  ({ serverUrl, token }) => {
    serverInput.value = serverUrl;
    tokenInput.value  = token;
  }
);

// 백그라운드 연결 상태 확인
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  const connected = res?.connected ?? false;
  dot.className        = 'dot ' + (connected ? 'on' : 'off');
  statusText.textContent = connected ? '서버 연결됨' : '연결 안 됨';
});

// 저장 & 재연결
saveBtn.addEventListener('click', () => {
  const serverUrl = serverInput.value.trim();
  const token     = tokenInput.value.trim();
  if (!serverUrl || !token) return;

  chrome.storage.local.set({ serverUrl, token }, () => {
    chrome.runtime.sendMessage({ type: 'RECONNECT' });
    savedMsg.style.display = 'block';
    setTimeout(() => { savedMsg.style.display = 'none'; }, 2000);
  });
});
