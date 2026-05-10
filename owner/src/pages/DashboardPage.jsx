import { useEffect, useRef, useState } from 'react';
import { getRecommendations, createRec, updateRec, setStatus, updateMe, updateNotice, getHistory, updatePlatforms, getMe, getSongComments } from '../api';
import { getSocket, disconnectSocket } from '../socket';
import RecommendCard from './RecommendCard';
import StatsPanel from './StatsPanel';

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
      if (action === 'add')    setRecs(prev => prev.some(r => r.id === rec.id) ? prev : [rec, ...prev]);
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
    <div style={styles.page}>
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
        <button onClick={() => handleTabChange('contact')} style={{ ...styles.tab, ...(tab === 'contact' ? styles.tabActive : {}) }}>문의</button>
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
                onClick={() => setHistoryExpanded(v => v === r.video_id ? null : r.video_id)}
                style={{ cursor: 'pointer' }}
              >
                <RecommendCard slug={cafe.slug} rec={r} onUpdate={handleUpdate} onDelete={handleDelete}
                  expanded={historyExpanded === r.video_id} />
              </div>
              {historyExpanded === r.video_id && (
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
      {tab === 'contact' && <ContactTab provider={cafe.provider} />}
    </div>
  );
}


function DefaultSection({ defaultVideo, isPlaying, onSet, onClear, widevineStatus }) {
  const [inputUrl, setInputUrl] = useState('');
  const [setting, setSetting]   = useState(false);
  const [error, setError]       = useState('');

  async function handleSet() {
    const url = inputUrl.trim();
    if (!/^https?:\/\//i.test(url)) { setError('http(s)로 시작하는 URL을 입력하세요'); return; }
    setSetting(true); setError('');
    try {
      // YouTube/SoundCloud/Spotify는 서버 oembed로 메타데이터 시도, 그 외 또는 플레이리스트는 URL만 저장
      let info = { url, title: url, thumbnail: null };
      try {
        const base = import.meta.env.VITE_SERVER_URL ? `${import.meta.env.VITE_SERVER_URL}/api/v1` : '/api/v1';
        const res  = await fetch(`${base}/tracks/oembed?url=${encodeURIComponent(url)}`);
        if (res.ok) {
          const data = await res.json();
          info = { url, title: data.title || url, thumbnail: data.thumbnail || null };
        }
      } catch { /* oembed 실패는 무시하고 URL만 저장 */ }
      onSet(info);
      setInputUrl('');
    } catch {
      setError('등록에 실패했습니다');
    } finally {
      setSetting(false);
    }
  }

  if (defaultVideo) {
    const url = defaultVideo.url || (defaultVideo.videoId?.startsWith('http')
      ? defaultVideo.videoId
      : `https://www.youtube.com/watch?v=${defaultVideo.videoId}`);
    return (
      <div
        style={dfStyles.card}
        draggable={true}
        onDragStart={e => {
          e.dataTransfer.setData('text/plain', JSON.stringify({
            type: 'default',
            videoId:   defaultVideo.videoId || url,
            title:     defaultVideo.title,
            thumbnail: defaultVideo.thumbnail,
          }));
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, cursor: 'pointer' }}
          onClick={() => window.electronAPI?.setBgmUrl(url)}
          title="클릭하면 해당 링크로 이동"
          draggable={false}
          onDragStart={e => e.stopPropagation()}
        >
        {defaultVideo.thumbnail
          ? <img src={defaultVideo.thumbnail} alt="" style={dfStyles.thumb} />
          : <div style={{ ...dfStyles.thumb, background: '#eee' }} />
        }
        <div style={dfStyles.info}>
          {isPlaying && <span style={dfStyles.playing}>▶ 재생 중</span>}
          <div style={dfStyles.title}>{defaultVideo.title}</div>
          <div style={dfStyles.hint}>클릭하면 해당 플레이어로 이동 · 신청곡 없을 때 자동 재생</div>
          {/spotify\.com/i.test(url) && widevineStatus === 'not_found' && (
            <div style={dfStyles.warn}>⚠️ Chrome 미설치 — Spotify 재생 불가</div>
          )}
          {/spotify\.com/i.test(url) && widevineStatus?.startsWith('loaded') && (
            <div style={{ ...dfStyles.hint, color: '#1db954' }}>✓ Widevine 로드됨</div>
          )}
        </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
          {/spotify\.com/i.test(url) && (
            <button
              onClick={() => window.electronAPI?.openLoginWindow('https://accounts.spotify.com/ko/login')}
              draggable={false} onDragStart={e => e.stopPropagation()}
              style={{ ...dfStyles.clearBtn, background: '#1db954', color: '#fff', border: 'none' }}
            >Spotify 로그인</button>
          )}
          {/soundcloud\.com/i.test(url) && (
            <button
              onClick={() => window.electronAPI?.openLoginWindow('https://soundcloud.com/signin')}
              draggable={false} onDragStart={e => e.stopPropagation()}
              style={{ ...dfStyles.clearBtn, background: '#ff5500', color: '#fff', border: 'none' }}
            >SoundCloud 로그인</button>
          )}
          <button
            onClick={onClear}
            draggable={false}
            onDragStart={e => e.stopPropagation()}
            style={dfStyles.clearBtn}
          >해제</button>
        </div>
      </div>
    );
  }

  return (
    <div style={dfStyles.inputRow}>
      <input
        value={inputUrl}
        onChange={e => { setInputUrl(e.target.value); setError(''); }}
        onKeyDown={e => e.key === 'Enter' && handleSet()}
        placeholder="YouTube/Spotify/SoundCloud 링크 — 플레이리스트도 OK"
        style={dfStyles.input}
      />
      <button onClick={handleSet} disabled={setting || !inputUrl.trim()} style={dfStyles.setBtn}>
        {setting ? '...' : '설정'}
      </button>
      {error && <div style={dfStyles.error}>{error}</div>}
    </div>
  );
}

const dfStyles = {
  card:     { display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: '1px solid #eee' },
  thumb:    { width: 80, height: 56, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  info:     { flex: 1, minWidth: 0 },
  playing:  { fontSize: 11, fontWeight: 700, color: '#2196f3', display: 'block', marginBottom: 2 },
  title:    { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  hint:     { fontSize: 11, color: '#aaa', marginTop: 2 },
  warn:     { fontSize: 11, color: '#e63946', marginTop: 2 },
  clearBtn: { fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', flexShrink: 0 },
  inputRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid #eee' },
  input:    { flex: 1, fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', outline: 'none', minWidth: 0 },
  setBtn:   { fontSize: 12, padding: '6px 14px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, flexShrink: 0 },
  error:    { fontSize: 12, color: '#e63946', width: '100%' },
};



const PLATFORMS = [
  { id: 'youtube',    label: 'YouTube',    color: '#ff0000' },
  { id: 'soundcloud', label: 'SoundCloud', color: '#ff5500' },
  { id: 'spotify',    label: 'Spotify',    color: '#1db954' },
];

function SettingsTab({ allowedPlatforms, saving, onSave }) {
  const [selected, setSelected] = useState(allowedPlatforms);

  useEffect(() => { setSelected(allowedPlatforms); }, [allowedPlatforms]);

  function toggle(id) {
    setSelected(prev => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev; // 최소 1개
        return prev.filter(p => p !== id);
      }
      return [...prev, id];
    });
  }

  const changed = JSON.stringify([...selected].sort()) !== JSON.stringify([...allowedPlatforms].sort());

  return (
    <div style={settingsStyles.wrap}>
      <div style={settingsStyles.section}>
        <div style={settingsStyles.title}>허용 플랫폼</div>
        <div style={settingsStyles.desc}>손님이 추천할 수 있는 음악 플랫폼을 선택하세요.</div>
        <div style={settingsStyles.platforms}>
          {PLATFORMS.map(p => {
            const active = selected.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                style={{
                  ...settingsStyles.platformBtn,
                  ...(active
                    ? { background: p.color, color: '#fff', borderColor: p.color }
                    : { background: '#f0f0f0', color: '#aaa', borderColor: '#ddd' }),
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        {selected.length === 1 && (
          <div style={settingsStyles.hint}>최소 1개 플랫폼은 활성화해야 합니다.</div>
        )}
        {changed && (
          <button onClick={() => onSave(selected)} disabled={saving} style={settingsStyles.saveBtn}>
            {saving ? '저장 중...' : '저장'}
          </button>
        )}
      </div>

      <div style={settingsStyles.section}>
        <div style={settingsStyles.title}>디버그</div>
        <div style={settingsStyles.desc}>오른쪽 브라우저(BGM 플레이어)의 개발자 도구를 엽니다.</div>
        <button
          onClick={() => window.electronAPI?.openBgmDevTools()}
          style={settingsStyles.saveBtn}
        >BGM DevTools 열기</button>
      </div>
    </div>
  );
}

const settingsStyles = {
  wrap:        { paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 16 },
  section:     { background: '#f8f8f8', borderRadius: 12, padding: 20 },
  title:       { fontSize: 15, fontWeight: 700, marginBottom: 4 },
  desc:        { fontSize: 13, color: '#888', marginBottom: 16 },
  platforms:   { display: 'flex', gap: 10, flexWrap: 'wrap' },
  platformBtn: { padding: '10px 20px', borderRadius: 10, border: '2px solid', fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' },
  hint:        { fontSize: 12, color: '#ff9800', marginTop: 8 },
  saveBtn:     { marginTop: 16, padding: '10px 28px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
};

function QRTab({ url, cafeName }) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=280x280&margin=10`;

  async function handleDownload() {
    const src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=600x600&margin=20&format=jpg`;
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `caffeine-flow-${cafeName}-qr.jpg`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // CORS/네트워크 실패 시 새 탭 fallback
      window.open(src, '_blank');
    }
  }

  function handlePrint() { window.print(); }

  return (
    <div style={qrStyles.outer}>
      <style>{`
        @media print {
          @page { size: auto; margin: 0; }
          html, body { margin: 0; padding: 0; height: 100vh; overflow: hidden; }
          body * { visibility: hidden; }
          .print-poster, .print-poster * { visibility: visible; }
          .print-poster { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
        }
      `}</style>

      {/* QR 카드 */}
      <div style={qrStyles.poster} className="print-poster">
        <div style={qrStyles.qrWrap}>
          <img src={qrUrl} alt="QR 코드" style={qrStyles.qrImg} />
        </div>
      </div>

      {/* 버튼 (프린트 시 숨김) */}
      <div style={qrStyles.btnRow} className="no-print">
        <button onClick={handlePrint} style={qrStyles.btn}>프린트</button>
        <button onClick={handleDownload} style={{ ...qrStyles.btn, background: '#fff', color: '#1a1a2e', border: '1px solid #ddd' }}>이미지 저장</button>
      </div>
    </div>
  );
}

function ContactTab({ provider }) {
  const subject = 'Caffeine Flow 문의';
  const to      = 'sngmng6506@gmail.com';
  const mailUrl = provider === 'naver'
    ? `https://mail.naver.com/write?to=${to}&subject=${encodeURIComponent(subject)}`
    : `https://mail.google.com/mail/?view=cm&to=${to}&su=${encodeURIComponent(subject)}`;

  return (
    <div style={contactStyles.wrap}>
      <h3 style={contactStyles.title}>개발자 문의</h3>
      <div style={contactStyles.box}>
        <p style={contactStyles.desc}>
          사장님, 안녕하세요. <br />
        운영 중 불편한 점, 필요한 기능, 떠오른 아이디어가 있으시면 <br />
        아래 버튼을 눌러 메일을 보내주세요. <br />
        <br />
        작은 기능 개선부터, <br />
        “이런 것도 앱으로 가능할까?” 싶은 새로운 아이디어까지 모두 환영합니다.<br />

         <br />
        </p>
        <a href={mailUrl} target="_blank" rel="noreferrer" style={contactStyles.btn}>
          메일 보내기
        </a>
      </div>
    </div>
  );
}

const styles = {
  page:              { maxWidth: 600, margin: '0 auto', padding: '16px', fontFamily: 'sans-serif' },
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
  tabs:              { display: 'flex', marginBottom: 16, borderBottom: '2px solid #eee' },
  tab:               { padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#888', display: 'flex', alignItems: 'center', gap: 6 },
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

const qrStyles = {
  outer:          { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, paddingTop: 16 },
  poster:         { borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', border: '1px solid #eee', display: 'inline-flex' },
  brand:          { fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' },
  tagline:        { fontSize: 11, color: '#aaa', marginTop: 4, letterSpacing: 1 },
  posterBody:     { background: '#fff', padding: '24px 24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  cta:            { fontSize: 15, fontWeight: 600, color: '#1a1a2e', textAlign: 'center', lineHeight: 1.6 },
  qrWrap:         { background: '#fff', padding: 20 },
  qrImg:          { display: 'block', width: 240, height: 240 },
  posterCafeName: { fontSize: 14, fontWeight: 700, color: '#333' },
  urlText:        { fontSize: 10, color: '#bbb', wordBreak: 'break-all', textAlign: 'center' },
  posterFooter:   { background: '#f8f8f8', padding: '10px 24px', textAlign: 'center', borderTop: '1px solid #eee' },
  devInfo:        { fontSize: 10, color: '#bbb', fontFamily: 'monospace' },
  btnRow:         { display: 'flex', gap: 10 },
  btn:            { padding: '10px 24px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
};

function OwnerCommentSection({ videoId }) {
  const [comments, setComments] = useState(null);

  useEffect(() => {
    getSongComments(videoId).then(setComments).catch(() => setComments([]));
  }, [videoId]);

  if (comments === null) return <div style={commentStyles.wrap}><div style={commentStyles.loading}>댓글 불러오는 중...</div></div>;
  if (comments.length === 0) return <div style={commentStyles.wrap}><div style={commentStyles.empty}>댓글이 없습니다.</div></div>;

  return (
    <div style={commentStyles.wrap}>
      {comments.map(c => (
        <div key={c.id} style={commentStyles.item}>
          <div style={commentStyles.meta}>
            <span style={commentStyles.name}>{c.commenter_name || '익명'}</span>
            <span style={commentStyles.date}>{new Date(c.created_at).toLocaleDateString('ko-KR')}</span>
          </div>
          <div style={commentStyles.body}>{c.body}</div>
          {c.replies?.length > 0 && (
            <div style={commentStyles.replies}>
              {c.replies.map(r => (
                <div key={r.id} style={commentStyles.replyItem}>
                  <div style={commentStyles.meta}>
                    <span style={commentStyles.name}>{r.commenter_name || '익명'}</span>
                    <span style={commentStyles.date}>{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                  <div style={commentStyles.body}>{r.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const commentStyles = {
  wrap:      { padding: '12px 12px 16px 16px', background: '#fafafa', borderRadius: 8, marginBottom: 4 },
  loading:   { fontSize: 13, color: '#aaa', padding: '8px 0' },
  empty:     { fontSize: 13, color: '#aaa', padding: '8px 0' },
  item:      { marginTop: 12 },
  meta:      { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 },
  name:      { fontSize: 13, fontWeight: 700 },
  date:      { fontSize: 11, color: '#aaa' },
  body:      { fontSize: 13, lineHeight: 1.5 },
  replies:   { marginTop: 8, paddingLeft: 16, borderLeft: '2px solid #eee' },
  replyItem: { marginTop: 8 },
};

const contactStyles = {
  wrap:  { paddingTop: 16 },
  title: { fontSize: 15, fontWeight: 700, marginBottom: 16 },
  box:   { background: '#f8f8f8', borderRadius: 12, padding: 24 },
  desc:  { fontSize: 14, color: '#666', lineHeight: 1.8, marginBottom: 20 },
  btn:   { display: 'block', background: '#1a1a2e', color: '#fff', textAlign: 'center', borderRadius: 8, padding: '13px', fontSize: 14, fontWeight: 700, textDecoration: 'none' },
};
