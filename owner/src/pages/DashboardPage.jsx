import { useEffect, useRef, useState } from 'react';
import { getRecommendations, createRec, updateRec, setStatus, updateMe, updateNotice, getHistory, updatePlatforms, getMe } from '../api';
import { getSocket, disconnectSocket } from '../socket';
import RecommendCard from './RecommendCard';
import StatsPanel from './StatsPanel';
import DefaultSection from './dashboard/DefaultSection';
import SettingsTab from './dashboard/SettingsTab';
import QRTab from './dashboard/QRTab';
import ContactTab from './dashboard/ContactTab';
import OwnerCommentSection from './dashboard/OwnerCommentSection';
import ShortcutsTab from './dashboard/ShortcutsTab';

// 저장된 default 정보 → BGM URL 변환 (구버전 데이터 호환: videoId only도 처리)
function savedToBgmUrl(info) {
  if (!info) return null;
  if (info.url) return info.url;
  if (info.videoId?.startsWith('http')) return info.videoId;
  return `https://www.youtube.com/watch?v=${info.videoId}`;
}



export default function DashboardPage({ cafe: initialCafe, onLogout }) {
  const [cafe, setCafe]         = useState(initialCafe);
  const [recs, setRecs]         = useState([]);
  const recsRef = useRef([]);
  const [isAccepting, setIsAccepting] = useState(true);
  const [dragOver, setDragOver]           = useState(null); // 'playing' | 'accepted' | 'pending' | null
  const [nowPlaying, setNowPlaying]       = useState(null);
  const [defaultVideo, setDefaultVideo] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cf_default_video')); } catch { return null; }
  });
  const videoEndingRef = useRef(false);
  const [tab, setTab]           = useState('queue');
  const [loading, setLoading]   = useState(true);
  const [history, setHistory]           = useState([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDate, setHistoryDate]   = useState('');
  const [editingName, setEditingName]       = useState(false);
  const [nameInput, setNameInput]           = useState('');
  const [nameLoading, setNameLoading]       = useState(false);
  const [editingNotice, setEditingNotice]   = useState(false);
  const [noticeInput, setNoticeInput]       = useState('');
  const [noticeLoading, setNoticeLoading]   = useState(false);
  const [allowedPlatforms, setAllowedPlatforms] = useState(['youtube', 'soundcloud', 'spotify']);
  const [platformSaving, setPlatformSaving] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(null);

  recsRef.current = recs;
  const queue = recs.filter(r => r.status === 'pending' || r.status === 'accepted' || r.status === 'playing');

  const [customerUrl, setCustomerUrl] = useState('');
  const [widevineStatus, setWidevineStatus] = useState(null);
  const [autoAccept, setAutoAccept] = useState(() => localStorage.getItem('cf_auto_accept') === 'true');
  const autoAcceptRef = useRef(autoAccept);
  autoAcceptRef.current = autoAccept;

  const [panelRatio, setPanelRatio] = useState(() => {
    const s = parseFloat(localStorage.getItem('cf_panel_ratio'));
    return isNaN(s) ? 0.42 : s;
  });
  const isDraggingDivider = useRef(false);

  // 앱 시작 시 저장된 panelRatio를 Electron에 동기화
  useEffect(() => {
    window.electronAPI?.setPanelRatio(panelRatio);
  }, []); // eslint-disable-line

  useEffect(() => {
    getRecommendations(cafe.slug)
      .then(async ({ recommendations, is_accepting }) => {
        // 앱 재시작 시 playing 상태 곡들을 accepted(대기 중)로 리셋
        const playingRecs = recommendations.filter(r => r.status === 'playing');
        if (playingRecs.length > 0) {
          const reset = await Promise.all(
            playingRecs.map(r => updateRec(cafe.slug, r.id, 'accepted').catch(() => r))
          );
          const resetMap = Object.fromEntries(reset.map(r => [r.id, r]));
          setRecs(recommendations.map(r => resetMap[r.id] ?? r));
        } else {
          setRecs(recommendations);
        }
        setIsAccepting(is_accepting);
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    // DB에서 최신 카페 정보 로드 (공지, 허용 플랫폼, 손님 URL 등)
    getMe().then(latest => {
      setCafe(prev => {
        const updated = { ...prev, name: latest.name || prev.name, notice: latest.notice ?? prev.notice };
        localStorage.setItem('cafe', JSON.stringify(updated));
        return updated;
      });
      if (latest.allowed_platforms) {
        setAllowedPlatforms(latest.allowed_platforms.split(','));
      }
      if (latest.customer_url) {
        setCustomerUrl(latest.customer_url);
      }
    }).catch(() => {});

    const socket = getSocket(cafe.slug);

    let connected = false;
    socket.on('connect', () => {
      if (!connected) { connected = true; return; }
      getRecommendations(cafe.slug)
        .then(({ recommendations, is_accepting }) => {
          setRecs(recommendations);
          setIsAccepting(is_accepting);
        })
        .catch(() => {});
    });

    socket.on('recommendations_update', ({ action, rec, id }) => {
      if (action === 'add') {
        if (autoAcceptRef.current) {
          updateRec(cafe.slug, rec.id, 'accepted')
            .then(updated => {
              setRecs(prev => prev.some(r => r.id === updated.id)
                ? prev.map(r => r.id === updated.id ? updated : r)
                : [...prev, updated]
              );
              const hasPlaying = recsRef.current.some(r => r.status === 'playing');
              if (!hasPlaying) {
                updateRec(cafe.slug, updated.id, 'playing')
                  .then(playing => {
                    setRecs(prev => prev.map(r => r.id === playing.id ? playing : r));
                    window.electronAPI?.playRec(playing.video_id);
                  })
                  .catch(console.error);
              }
            })
            .catch(() => {
              setRecs(prev => prev.some(r => r.id === rec.id) ? prev : [rec, ...prev]);
            });
        } else {
          setRecs(prev => prev.some(r => r.id === rec.id) ? prev : [rec, ...prev]);
        }
      }
      if (action === 'update' || action === 'vote') setRecs(prev => prev.map(r => r.id === rec.id ? rec : r));
      if (action === 'delete') setRecs(prev => prev.filter(r => r.id !== id));
    });
    socket.on('system_toggled', ({ is_accepting }) => setIsAccepting(is_accepting));

    window.electronAPI?.onNowPlaying(info => setNowPlaying(info));
    window.electronAPI?.onWidevineStatus(s => setWidevineStatus(s));

    // 앱 시작 시 저장된 BGM URL을 bgmView에 미리 로드 (사장님이 ▶ 한 번 눌러두면 끝)
    const savedBgm = (() => { try { return JSON.parse(localStorage.getItem('cf_default_video')); } catch { return null; } })();
    const savedBgmUrl = savedToBgmUrl(savedBgm);
    if (savedBgmUrl) window.electronAPI?.setBgmUrl(savedBgmUrl);

    // 영상 종료 감지:
    // 1) playing → played
    // 2) 대기곡(accepted) 1순위 있으면 playRec으로 이어 재생
    // 3) 대기곡 없으면 endRec — bgmView 음소거 해제만 (BGM은 백그라운드에서 계속 재생 중)
    window.electronAPI?.onVideoEnded(() => {
      const playing = recsRef.current.find(r => r.status === 'playing');
      if (!playing) return;
      updateRec(cafe.slug, playing.id, 'played')
        .then(updated => {
          setRecs(prev => prev.map(r => r.id === updated.id ? updated : r));
          const latest = recsRef.current.map(r => r.id === updated.id ? updated : r);
          const nextAccepted = latest
            .filter(r => r.status === 'accepted')
            .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at))[0];
          if (nextAccepted) {
            updateRec(cafe.slug, nextAccepted.id, 'playing')
              .then(acc => {
                setRecs(prev => prev.map(r => r.id === acc.id ? acc : r));
                window.electronAPI?.playRec(acc.video_id);
              })
              .catch(console.error);
          } else {
            // BGM이 백그라운드에서 음소거 상태로 계속 재생 중 — 음소거만 풀면 끊김 없이 이어 들림
            window.electronAPI?.endRec();
          }
        })
        .catch(console.error);
    });

    // 앱 종료 직전: 현재 playing 곡들을 played로 마킹 → 손님 화면에 "재생 중" 가짜 표시 제거.
    // pending·accepted 큐는 유지 (다음 영업 시작 시 이어 재생).
    // 메서드 호출에도 ?. — 구버전 Electron(preload에 onCleanupBeforeQuit 없음)에서 TypeError 방지.
    window.electronAPI?.onCleanupBeforeQuit?.(async () => {
      try {
        const playing = recsRef.current.filter(r => r.status === 'playing');
        await Promise.all(
          playing.map(r => updateRec(cafe.slug, r.id, 'played').catch(() => null))
        );
      } catch {}
      window.electronAPI?.cleanupDone?.();
    });

    return () => {
      disconnectSocket();
      window.electronAPI?.removeAllListeners();
    };
  }, [cafe.slug]);

  async function toggleAccepting() {
    const next = !isAccepting;
    setIsAccepting(next);
    try { await setStatus(next); }
    catch { setIsAccepting(!next); }
  }

  async function toggleAutoAccept() {
    const next = !autoAccept;
    setAutoAccept(next);
    localStorage.setItem('cf_auto_accept', String(next));
    if (!next) return; // OFF 전환은 즉시 종료

    // ON 전환: 추천곡 → 대기곡 일괄 이동 + 재생 중 없으면 첫 대기곡 자동 재생
    let snapshot = recsRef.current;
    const pending = snapshot.filter(r => r.status === 'pending');
    if (pending.length > 0) {
      const updates = (await Promise.all(
        pending.map(r => updateRec(cafe.slug, r.id, 'accepted').catch(() => null))
      )).filter(Boolean);
      const updateMap = Object.fromEntries(updates.map(u => [u.id, u]));
      snapshot = snapshot.map(r => updateMap[r.id] || r);
      setRecs(snapshot);
    }

    const hasPlaying = snapshot.some(r => r.status === 'playing');
    if (hasPlaying) return;

    const firstAccepted = snapshot
      .filter(r => r.status === 'accepted')
      .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at))[0];
    if (!firstAccepted) return;

    try {
      const playing = await updateRec(cafe.slug, firstAccepted.id, 'playing');
      setRecs(prev => prev.map(r => r.id === playing.id ? playing : r));
      window.electronAPI?.playRec(playing.video_id);
    } catch (e) { console.error(e); }
  }

  function handleDividerMouseDown(e) {
    e.preventDefault();
    isDraggingDivider.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // 드래그 동안 BrowserView 임시 detach — renderer 가 전체 윈도우 mousemove 캡처.
    window.electronAPI?.dividerDragStart?.();
    function onMove(ev) {
      if (!isDraggingDivider.current) return;
      const ratio = Math.min(0.85, Math.max(0.15, ev.clientX / window.innerWidth));
      setPanelRatio(ratio);
      localStorage.setItem('cf_panel_ratio', String(ratio));
      window.electronAPI?.setPanelRatio(ratio);
    }
    function onUp() {
      isDraggingDivider.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.electronAPI?.dividerDragEnd?.();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  async function handleNameSave() {
    if (!nameInput.trim() || nameInput === cafe.name) { setEditingName(false); return; }
    setNameLoading(true);
    try {
      const updated = await updateMe(nameInput.trim());
      setCafe(prev => ({ ...prev, name: updated.name }));
      localStorage.setItem('cafe', JSON.stringify({ ...cafe, name: updated.name }));
      setEditingName(false);
    } catch (e) {
      console.error(e);
    } finally {
      setNameLoading(false);
    }
  }

  async function handleNoticeSave() {
    setNoticeLoading(true);
    try {
      const { notice } = await updateNotice(noticeInput.trim() || null);
      setCafe(prev => ({ ...prev, notice }));
      setEditingNotice(false);
    } catch (e) {
      console.error(e);
    } finally {
      setNoticeLoading(false);
    }
  }

  function handleSetDefault(info) {
    setDefaultVideo(info);
    localStorage.setItem('cf_default_video', JSON.stringify(info));
    const url = savedToBgmUrl(info);
    if (url) window.electronAPI?.setBgmUrl(url);
  }

  function handleClearDefault() {
    setDefaultVideo(null);
    localStorage.removeItem('cf_default_video');
    window.electronAPI?.clearBgm();
  }

  async function handleDrop(e, targetStatus) {
    e.preventDefault();
    setDragOver(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));

      // 추천 재생 중으로 이동 시 기존 playing 곡을 played로 처리
      // (handleUpdate 대신 setRecs 직접 호출 — handleUpdate는 playNextOrStop을 트리거하므로 두 곡이 동시에 playing 되는 버그 방지)
      if (targetStatus === 'playing') {
        const currentPlaying = recsRef.current.find(r => r.status === 'playing');
        if (currentPlaying && currentPlaying.id !== data.id) {
          const ended = await updateRec(cafe.slug, currentPlaying.id, 'played');
          setRecs(prev => prev.map(r => r.id === ended.id ? ended : r));
        }
      }

      // 기본 카드 → rec으로 변환하여 해당 섹션에 추가
      if (data.type === 'default') {
        const rec = await createRec(cafe.slug, {
          videoId: data.videoId, title: data.title,
          thumbnail: data.thumbnail, status: targetStatus,
        });
        setRecs(prev => prev.some(r => r.id === rec.id) ? prev : [...prev, rec]);
        handleClearDefault();
        if (targetStatus === 'playing') window.electronAPI?.playRec(data.videoId);
        return;
      }

      const { id, status: fromStatus } = data;
      if (fromStatus === targetStatus) return;
      const rec = recs.find(r => r.id === id);
      if (!rec) return;
      const updated = await updateRec(cafe.slug, id, targetStatus);
      handleUpdate(updated);
      if (targetStatus === 'playing') window.electronAPI?.playRec(rec.video_id);
    } catch (err) { console.error(err); }
  }

  function handleDropToDefault(e) {
    e.preventDefault();
    setDragOver(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.type === 'default') return;
      const rec = recs.find(r => r.id === data.id);
      if (!rec) return;
      handleSetDefault({ videoId: rec.video_id, title: rec.title, thumbnail: rec.thumbnail });
    } catch (err) { console.error(err); }
  }

  // [자동재생 비활성화] 큐 자동 진행 함수
  // function playNextOrStop(currentRecs) {
  //   const accepted = currentRecs.filter(r => r.status === 'accepted')
  //     .sort((a, b) => new Date(a.requested_at) - new Date(b.requested_at));
  //   const pending  = currentRecs.filter(r => r.status === 'pending')
  //     .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at));
  //   const nextSong = accepted[0] || pending[0];
  //   if (nextSong) {
  //     updateRec(cafe.slug, nextSong.id, 'playing')
  //       .then(played => {
  //         setRecs(prev => prev.map(r => r.id === played.id ? played : r));
  //         window.electronAPI?.playVideo(played.video_id);
  //       })
  //       .catch(console.error);
  //   } else {
  //     window.electronAPI?.stopVideo();
  //   }
  // }

  function handleUpdate(updated) {
    setRecs(prev => prev.map(r => r.id === updated.id ? updated : r));
    // 수락 시 재생 중인 곡 없으면 즉시 재생
    if (updated.status === 'accepted') {
      const hasPlaying = recsRef.current.some(r => r.status === 'playing');
      if (!hasPlaying) {
        updateRec(cafe.slug, updated.id, 'playing')
          .then(playing => {
            setRecs(prev => prev.map(r => r.id === playing.id ? playing : r));
            window.electronAPI?.playRec(playing.video_id);
          })
          .catch(console.error);
      }
    }
  }
  function handleDelete(id) { setRecs(prev => prev.filter(r => r.id !== id)); }

  function loadHistory(offset = 0, date = historyDate) {
    setHistoryLoading(true);
    getHistory(offset, date || null)
      .then(({ items, hasMore }) => {
        setHistory(prev => offset === 0 ? items : [...prev, ...items]);
        setHistoryHasMore(hasMore);
      })
      .catch(console.error)
      .finally(() => setHistoryLoading(false));
  }

  function handleHistoryDateChange(date) {
    setHistoryDate(date);
    setHistory([]);
    loadHistory(0, date || null);
  }

  function handleTabChange(t) {
    setTab(t);
    if (t === 'history' && history.length === 0) loadHistory(0);
  }

  return (
    <div style={{ ...styles.page, margin: 0, width: `calc(${(panelRatio * 100).toFixed(2)}vw - 32px)`, maxWidth: 'none' }}>
      {/* 좌우 패널 구분선 — 드래그로 비율 조정.
          BrowserView 가 left=panelRatio% 부터 시작하는 네이티브 레이어라
          그 픽셀에 div 를 놓으면 BrowserView 가 mousedown 을 가로채 클릭이 안 잡힘.
          그래서 div 를 좌측으로 8px 시프트해 클릭 영역을 전부 renderer 안에 둠.
          시각적 line은 right 끝에 두어 BrowserView 경계와 맞붙어 보이게. */}
      <div
        onMouseDown={handleDividerMouseDown}
        title="드래그하여 좌우 비율 조정"
        style={{
          position: 'fixed', top: 0, left: `calc(${(panelRatio * 100).toFixed(2)}% - 8px)`,
          width: 8, height: '100vh', cursor: 'col-resize', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          background: 'transparent',
        }}
      >
        <div style={{ width: 2, height: '100%', background: '#ddd', borderRadius: 2 }} />
      </div>
      <div style={styles.header}>
        <div>
          {editingName ? (
            <div style={styles.nameEditRow}>
              <input
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') setEditingName(false); }}
                style={styles.nameInput}
                autoFocus
                maxLength={50}
              />
              <button onClick={handleNameSave} disabled={nameLoading} style={styles.nameSaveBtn}>
                {nameLoading ? '...' : '저장'}
              </button>
              <button onClick={() => setEditingName(false)} style={styles.nameCancelBtn}>취소</button>
            </div>
          ) : (
            <div style={styles.nameRow}>
              <div style={styles.cafeName}>{cafe.name}</div>
              <button
                onClick={() => { setNameInput(cafe.name); setEditingName(true); }}
                style={styles.nameEditBtn}
              >✏️</button>
            </div>
          )}
          <div style={styles.urlRow}>
            <span style={styles.urlLabel}>손님 접속용 URL</span>
            <span style={styles.url}>{customerUrl}</span>
          </div>
        </div>
        <div style={styles.headerRight}>
          <button onClick={toggleAccepting} style={{ ...styles.toggleBtn, background: isAccepting ? '#4caf50' : '#888' }}>
            {isAccepting ? '추천 받는 중' : '추천 닫힘'}
          </button>
          <button onClick={toggleAutoAccept} style={{ ...styles.toggleBtn, background: autoAccept ? '#ff9800' : '#9e9e9e', fontSize: 12 }}>
            자동 수락 {autoAccept ? 'ON' : 'OFF'}
          </button>
          <button onClick={onLogout} style={styles.logoutBtn}>로그아웃</button>
        </div>
      </div>

      {/* 공지사항 */}
      {editingNotice ? (
        <div style={styles.noticeEdit}>
          <textarea
            value={noticeInput}
            onChange={e => setNoticeInput(e.target.value)}
            placeholder="손님에게 표시될 공지사항을 입력하세요"
            style={styles.noticeInput}
            maxLength={200}
            autoFocus
            rows={2}
          />
          <div style={styles.noticeActions}>
            <span style={styles.noticeCount}>{noticeInput.length}/200</span>
            <button onClick={() => setEditingNotice(false)} style={styles.nameCancelBtn}>취소</button>
            <button onClick={handleNoticeSave} disabled={noticeLoading} style={styles.nameSaveBtn}>
              {noticeLoading ? '...' : '저장'}
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.noticeRow}>
          {cafe.notice
            ? <div style={styles.noticeBadge}>📢 {cafe.notice}</div>
            : <div style={styles.noticePlaceholder}>공지사항 없음</div>
          }
          <button
            onClick={() => { setNoticeInput(cafe.notice || ''); setEditingNotice(true); }}
            style={styles.noticeEditBtn}
          >
            {cafe.notice ? '수정' : '+ 공지 등록'}
          </button>
          {cafe.notice && (
            <button onClick={() => { setNoticeInput(''); handleNoticeSave(); }} style={styles.noticeDeleteBtn}>삭제</button>
          )}
        </div>
      )}

      <div style={styles.tabs}>
        <button onClick={() => handleTabChange('queue')}   style={{ ...styles.tab, ...(tab === 'queue'   ? styles.tabActive : {}) }}>
          추천 목록 {recs.filter(r => r.status === 'pending').length > 0 && <span style={styles.badge}>{recs.filter(r => r.status === 'pending').length}</span>}
        </button>
        <button onClick={() => handleTabChange('history')} style={{ ...styles.tab, ...(tab === 'history' ? styles.tabActive : {}) }}>이력</button>
        <button onClick={() => handleTabChange('stats')}   style={{ ...styles.tab, ...(tab === 'stats'   ? styles.tabActive : {}) }}>통계</button>
        <button onClick={() => handleTabChange('qr')}      style={{ ...styles.tab, ...(tab === 'qr'      ? styles.tabActive : {}) }}>QR 코드</button>
        <button onClick={() => handleTabChange('settings')} style={{ ...styles.tab, ...(tab === 'settings' ? styles.tabActive : {}) }}>설정</button>
        <button onClick={() => handleTabChange('contact')}   style={{ ...styles.tab, ...(tab === 'contact'   ? styles.tabActive : {}) }}>문의</button>
        <button onClick={() => handleTabChange('shortcuts')} style={{ ...styles.tab, ...(tab === 'shortcuts' ? styles.tabActive : {}) }}>바로가기</button>
      </div>

      {tab === 'queue' && (() => {
        const playing = recs.filter(r => r.status === 'playing');
        const accepted = recs.filter(r => r.status === 'accepted')
          .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at));
        const pending  = recs.filter(r => r.status === 'pending')
          .sort((a, b) => b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at));
        const hasPlaying = playing.length > 0;
        return (
          <div>
            {/* 기본 */}
            <div
              style={{ ...styles.section, ...(dragOver === 'default' ? styles.sectionDragOver : {}) }}
              onDragOver={e => { e.preventDefault(); setDragOver('default'); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={handleDropToDefault}
            >
              <div style={styles.sectionTitle}>기본</div>
              <DefaultSection
                defaultVideo={defaultVideo}
                isPlaying={!nowPlaying && !!defaultVideo}
                onSet={handleSetDefault}
                onClear={handleClearDefault}
                widevineStatus={widevineStatus}
              />
            </div>

            {/* 추천 재생 중 */}
            <div
              style={{ ...styles.section, ...(dragOver === 'playing' ? styles.sectionDragOver : {}) }}
              onDragOver={e => { e.preventDefault(); setDragOver('playing'); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => handleDrop(e, 'playing')}
            >
              <div style={styles.sectionTitle}>수락</div>
              {loading
                ? <div style={styles.emptySlot}>불러오는 중...</div>
                : playing.length > 0
                  ? playing.map(r => (
                      <RecommendCard key={r.id} slug={cafe.slug} rec={r}
                        onUpdate={handleUpdate} onDelete={handleDelete} context="playing" />
                    ))
                  : <div style={styles.emptySlot}>재생 중인 추천곡 없음</div>
              }
            </div>

            {/* 대기 곡 */}
            <div
              style={{ ...styles.section, ...(dragOver === 'accepted' ? styles.sectionDragOver : {}) }}
              onDragOver={e => { e.preventDefault(); setDragOver('accepted'); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => handleDrop(e, 'accepted')}
            >
              <div style={styles.sectionTitle}>대기 곡</div>
              {loading
                ? <div style={styles.emptySlot}>불러오는 중...</div>
                : accepted.length > 0
                  ? accepted.map((r, i) => (
                      <RecommendCard key={r.id} slug={cafe.slug} rec={r} position={i + 1}
                        onUpdate={handleUpdate} onDelete={handleDelete} context="accepted" />
                    ))
                  : <div style={styles.emptySlot}>대기 중인 곡 없음</div>
              }
            </div>

            {/* 추천 곡 */}
            <div
              style={{ ...styles.section, ...(dragOver === 'pending' ? styles.sectionDragOver : {}) }}
              onDragOver={e => { e.preventDefault(); setDragOver('pending'); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => handleDrop(e, 'pending')}
            >
              <div style={styles.sectionTitle}>
                추천 곡 {pending.length > 0 && <span style={styles.badge}>{pending.length}</span>}
              </div>
              {loading
                ? <div style={styles.emptySlot}>불러오는 중...</div>
                : pending.length > 0
                  ? pending.map((r, i) => (
                      <RecommendCard key={r.id} slug={cafe.slug} rec={r} position={i + 1}
                        onUpdate={handleUpdate} onDelete={handleDelete} context="pending" hasPlaying={hasPlaying} />
                    ))
                  : <div style={styles.emptySlot}>추천된 곡 없음</div>
              }
            </div>
          </div>
        );
      })()}

      {tab === 'history' && (
        <div>
          <div style={styles.historyFilter}>
            <input
              type="date"
              value={historyDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => handleHistoryDateChange(e.target.value)}
              style={styles.dateInput}
            />
            {historyDate && (
              <button onClick={() => handleHistoryDateChange('')} style={styles.dateClearBtn}>전체 보기</button>
            )}
          </div>
          {historyLoading && history.length === 0 && <div style={styles.empty}>불러오는 중...</div>}
          {!historyLoading && history.length === 0 && <div style={styles.empty}>이력이 없습니다.</div>}
          {history.map(r => (
            <div key={r.id}>
              <div
                onClick={() => setHistoryExpanded(v => v === r.id ? null : r.id)}
                style={{ cursor: 'pointer' }}
              >
                <RecommendCard slug={cafe.slug} rec={r} onUpdate={handleUpdate} onDelete={handleDelete}
                  expanded={historyExpanded === r.id} />
              </div>
              {historyExpanded === r.id && (
                <OwnerCommentSection videoId={r.video_id} />
              )}
            </div>
          ))}
          {historyHasMore && (
            <button onClick={() => loadHistory(history.length)} disabled={historyLoading} style={styles.moreBtn}>
              {historyLoading ? '불러오는 중...' : '더 보기'}
            </button>
          )}
        </div>
      )}

      {tab === 'stats'   && <StatsPanel />}
      {tab === 'qr'      && <QRTab url={customerUrl} cafeName={cafe.name} />}
      {tab === 'settings' && <SettingsTab allowedPlatforms={allowedPlatforms} saving={platformSaving} onSave={async (platforms) => {
        setPlatformSaving(true);
        try {
          const { allowed_platforms } = await updatePlatforms(platforms);
          setAllowedPlatforms(allowed_platforms);
        } catch (e) { alert(e.message); }
        finally { setPlatformSaving(false); }
      }} />}
      {tab === 'contact'   && <ContactTab provider={cafe.provider} />}
      {tab === 'shortcuts' && <ShortcutsTab />}
    </div>
  );
}


const styles = {
  page:              { padding: '16px', fontFamily: 'sans-serif' },
  header:            { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #eee' },
  nameRow:           { display: 'flex', alignItems: 'center', gap: 6 },
  cafeName:          { fontWeight: 700, fontSize: 18 },
  nameEditBtn:       { fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 },
  nameEditRow:       { display: 'flex', alignItems: 'center', gap: 6 },
  nameInput:         { fontSize: 16, fontWeight: 700, padding: '2px 6px', borderRadius: 6, border: '1px solid #ddd', outline: 'none', width: 160 },
  nameSaveBtn:       { fontSize: 12, padding: '3px 10px', borderRadius: 6, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer' },
  nameCancelBtn:     { fontSize: 12, padding: '3px 10px', borderRadius: 6, background: '#fff', border: '1px solid #ddd', cursor: 'pointer' },
  urlRow:            { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 },
  urlLabel:          { fontSize: 11, color: '#aaa' },
  url:               { fontSize: 12, color: '#888' },
  headerRight:       { display: 'flex', gap: 8, alignItems: 'center' },
  toggleBtn:         { padding: '6px 12px', borderRadius: 20, border: 'none', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  logoutBtn:         { padding: '6px 12px', borderRadius: 20, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13 },
  noticeRow:         { display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', padding: '8px 12px', background: '#f8f8f8', borderRadius: 8 },
  noticeBadge:       { flex: 1, fontSize: 13, color: '#333' },
  noticePlaceholder: { flex: 1, fontSize: 13, color: '#bbb' },
  noticeEditBtn:     { fontSize: 12, padding: '3px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' },
  noticeDeleteBtn:   { fontSize: 12, padding: '3px 10px', borderRadius: 6, border: '1px solid #fcc', background: '#fff', color: '#e63946', cursor: 'pointer' },
  noticeEdit:        { margin: '12px 0', display: 'flex', flexDirection: 'column', gap: 6 },
  noticeInput:       { fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', outline: 'none', resize: 'none', fontFamily: 'sans-serif' },
  noticeActions:     { display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' },
  noticeCount:       { fontSize: 12, color: '#aaa', marginRight: 'auto' },
  tabs:              { display: 'flex', marginBottom: 16, borderBottom: '2px solid #eee', overflowX: 'auto' },
  tab:               { padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#888', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 },
  tabActive:         { color: '#1a1a2e', fontWeight: 700, borderBottom: '2px solid #1a1a2e', marginBottom: -2 },
  badge:             { background: '#e63946', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11 },
  empty:             { textAlign: 'center', color: '#aaa', padding: '40px 0' },
  section:           { marginBottom: 20, borderRadius: 8, transition: 'background 0.15s' },
  sectionDragOver:   { background: '#f0f7ff', outline: '2px dashed #2196f3', outlineOffset: 2 },
  sectionTitle:      { fontSize: 13, fontWeight: 700, color: '#555', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 },
  emptySlot:         { fontSize: 13, color: '#ccc', padding: '12px 0', borderTop: '1px dashed #eee' },
  nowPlayingYt:      { display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: '1px solid #eee' },
  sectionThumb:      { width: 72, height: 50, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  ytBadge:           { fontSize: 11, fontWeight: 700, color: '#fff', background: '#ff9800', borderRadius: 4, padding: '2px 7px', display: 'inline-block', marginBottom: 4 },
  sectionSongTitle:  { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 },
  moreBtn:           { display: 'block', width: '100%', padding: '10px', marginTop: 8, borderRadius: 8, border: '1px solid #eee', background: '#f8f8f8', color: '#888', cursor: 'pointer', fontSize: 13 },
  historyFilter:     { display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' },
  dateInput:         { padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, outline: 'none' },
  dateClearBtn:      { fontSize: 12, padding: '5px 12px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', color: '#888' },
};
