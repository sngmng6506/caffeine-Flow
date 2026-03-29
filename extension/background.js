// Caffeine Flow - 백그라운드 서비스 워커
// 역할: 서버와 WebSocket 연결, YouTube 탭 음소거/제어

let ws = null;
let cafeMusicTabId = null;  // 카페에서 틀던 YouTube 탭 (음소거 대상)
let songTabId = null;       // 신청곡 재생 탭

// ── 설정 로드 ─────────────────────────────────────────────
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      { serverUrl: 'http://localhost:3000', token: 'cafe-secret-2024' },
      resolve
    );
  });
}

// ── 서버 연결 ─────────────────────────────────────────────
async function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const { serverUrl, token } = await getConfig();
  const wsUrl = serverUrl.replace(/^http/, 'ws');

  try {
    ws = new WebSocket(`${wsUrl}/extension?token=${token}`);
  } catch {
    setBadge(false);
    return;
  }

  ws.onopen = () => {
    console.log('[Caffeine Flow] 서버 연결됨');
    setBadge(true);
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'play_song') await playSong(msg.song.videoId);
      else if (msg.type === 'stop_song') await stopSong(true);
    } catch {}
  };

  ws.onclose = () => {
    setBadge(false);
    ws = null;
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

// ── 신청곡 재생 ────────────────────────────────────────────
async function playSong(videoId) {
  // 기존 YouTube 탭들 음소거 (신청곡 탭 제외)
  const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
  for (const tab of tabs) {
    if (tab.id !== songTabId) {
      cafeMusicTabId = tab.id;
      await chrome.tabs.setAudioMuted(tab.id, true).catch(() => {});
    }
  }

  // 이전 신청곡 탭 제거
  if (songTabId) {
    await chrome.tabs.remove(songTabId).catch(() => {});
    songTabId = null;
  }

  // 신청곡 새 탭으로 열기
  const newTab = await chrome.tabs.create({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    active: true,
  });
  songTabId = newTab.id;

  // 탭 로드 완료 후 content script 주입
  chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
    if (tabId === songTabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.scripting
        .executeScript({ target: { tabId: songTabId }, files: ['content.js'] })
        .catch(console.error);
    }
  });
}

// ── 재생 중단 & 원래 탭 복원 ──────────────────────────────
async function stopSong(unmute = true) {
  if (songTabId) {
    await chrome.tabs.remove(songTabId).catch(() => {});
    songTabId = null;
  }
  if (unmute && cafeMusicTabId) {
    await chrome.tabs.setAudioMuted(cafeMusicTabId, false).catch(() => {});
    cafeMusicTabId = null;
  }
}

// ── 메시지 수신 (content.js & popup.js) ──────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'VIDEO_ENDED') {
    stopSong(true);
    ws?.send(JSON.stringify({ type: 'song_ended' }));
  }
  if (msg.type === 'GET_STATUS') {
    sendResponse({ connected: ws?.readyState === WebSocket.OPEN });
  }
  if (msg.type === 'RECONNECT') {
    ws?.close();
    connect();
  }
  return true;
});

// ── 배지 표시 ─────────────────────────────────────────────
function setBadge(connected) {
  chrome.action.setBadgeText({ text: connected ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#4caf50' : '#888888' });
}

// ── 서비스 워커 유지 (알람으로 keepalive) ─────────────────
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    if (!ws || ws.readyState === WebSocket.CLOSED) connect();
  }
});

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
connect();
