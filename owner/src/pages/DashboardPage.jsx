import { useEffect, useRef, useState } from 'react';
import { createRec, updateRec, updatePlatforms } from '../api';
import { VALID_PLATFORMS } from '../constants/platforms';
import { REC_STATUS } from '../constants/recommendationStatus';
import StatsPanel from './StatsPanel';
import SettingsTab from './dashboard/SettingsTab';
import QRTab from './dashboard/QRTab';
import ContactTab from './dashboard/ContactTab';
import ShortcutsTab from './dashboard/ShortcutsTab';
import DashboardHeader from './dashboard/DashboardHeader';
import DashboardTabs from './dashboard/DashboardTabs';
import QueueTab from './dashboard/QueueTab';
import HistoryTab from './dashboard/HistoryTab';
import useRecommendationQueue from './dashboard/useRecommendationQueue';
import { readSavedBgm, savedToBgmUrl } from './dashboard/bgmStorage';
import { dashboardStyles as styles } from './dashboard/dashboardStyles';

const DEFAULT_DROP_TARGET = 'default';

export default function DashboardPage({ cafe: initialCafe, onLogout }) {
  const [cafe, setCafe] = useState(initialCafe);
  const [dragOver, setDragOver] = useState(null);
  const [defaultVideo, setDefaultVideo] = useState(readSavedBgm);
  const [tab, setTab] = useState('queue');
  const [allowedPlatforms, setAllowedPlatforms] = useState(VALID_PLATFORMS);
  const [platformSaving, setPlatformSaving] = useState(false);
  const [customerUrl, setCustomerUrl] = useState('');
  const [panelRatio, setPanelRatio] = useState(() => {
    const saved = parseFloat(localStorage.getItem('cf_panel_ratio'));
    return isNaN(saved) ? 0.42 : saved;
  });
  const isDraggingDivider = useRef(false);

  const {
    recommendations,
    setRecommendations,
    recommendationsRef,
    isAccepting,
    nowPlaying,
    loading,
    widevineStatus,
    aiAutoAccept,
    toggleAccepting,
    toggleAiAutoAccept,
    handleUpdate,
    handleDelete,
  } = useRecommendationQueue({
    cafe,
    setCafe,
    setAllowedPlatforms,
    setCustomerUrl,
    onPromptRequired: () => setTab('settings'),
  });

  // 앱 시작 시 저장된 panelRatio를 Electron에 동기화한다.
  useEffect(() => {
    window.electronAPI?.setPanelRatio(panelRatio);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDividerMouseDown(event) {
    event.preventDefault();
    isDraggingDivider.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.electronAPI?.dividerDragStart?.();

    function onMove(moveEvent) {
      if (!isDraggingDivider.current) return;
      const ratio = Math.min(0.85, Math.max(0.15, moveEvent.clientX / window.innerWidth));
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

  function handleCafePatch(patch) {
    setCafe(previous => {
      const next = { ...previous, ...patch };
      localStorage.setItem('cafe', JSON.stringify(next));
      return next;
    });
  }

  // QR 재발급/재등록 성공 시 새 토큰과 slug를 한 번에 교체한다.
  // cafe.slug가 바뀌면 큐 훅이 소켓과 API를 새 주소로 다시 연결한다.
  function handleSlugChanged(updated) {
    localStorage.setItem('token', updated.token);
    setCafe(previous => {
      const next = { ...previous, slug: updated.slug };
      localStorage.setItem('cafe', JSON.stringify(next));
      return next;
    });
    setCustomerUrl(updated.customer_url);
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

  async function handleDrop(event, targetStatus) {
    event.preventDefault();
    setDragOver(null);

    try {
      const data = JSON.parse(event.dataTransfer.getData('text/plain'));

      // 재생 중 섹션으로 옮길 때 기존 playing을 먼저 종료한다.
      // handleUpdate를 거치면 다음 곡 자동재생이 동시에 실행될 수 있어 직접 state만 갱신한다.
      if (targetStatus === REC_STATUS.PLAYING) {
        const currentPlaying = recommendationsRef.current.find(rec => rec.status === REC_STATUS.PLAYING);
        if (currentPlaying && currentPlaying.id !== data.id) {
          const ended = await updateRec(cafe.slug, currentPlaying.id, REC_STATUS.PLAYED);
          setRecommendations(previous => previous.map(rec => rec.id === ended.id ? ended : rec));
        }
      }

      // 기본 BGM 카드를 신청곡으로 변환한다.
      if (data.type === DEFAULT_DROP_TARGET) {
        const rec = await createRec(cafe.slug, {
          videoId: data.videoId,
          title: data.title,
          thumbnail: data.thumbnail,
          status: targetStatus,
        });
        setRecommendations(previous => previous.some(item => item.id === rec.id) ? previous : [...previous, rec]);
        handleClearDefault();
        if (targetStatus === REC_STATUS.PLAYING) window.electronAPI?.playRec(data.videoId);
        return;
      }

      const { id, status: fromStatus } = data;
      if (fromStatus === targetStatus) return;
      const rec = recommendations.find(item => item.id === id);
      if (!rec) return;

      const updated = await updateRec(cafe.slug, id, targetStatus);
      handleUpdate(updated);
      if (targetStatus === REC_STATUS.PLAYING) window.electronAPI?.playRec(rec.video_id);
    } catch (error) {
      console.error(error);
    }
  }

  function handleDropToDefault(event) {
    event.preventDefault();
    setDragOver(null);

    try {
      const data = JSON.parse(event.dataTransfer.getData('text/plain'));
      if (data.type === DEFAULT_DROP_TARGET) return;
      const rec = recommendations.find(item => item.id === data.id);
      if (!rec) return;
      handleSetDefault({ videoId: rec.video_id, title: rec.title, thumbnail: rec.thumbnail });
    } catch (error) {
      console.error(error);
    }
  }

  function handleDragOver(event, target) {
    event.preventDefault();
    setDragOver(target);
  }

  return (
    <div style={{ ...styles.page, width: `${(panelRatio * 100).toFixed(2)}vw` }}>
      {/* BrowserView 경계보다 8px 왼쪽에 renderer 드래그 영역을 둔다. */}
      <div
        onMouseDown={handleDividerMouseDown}
        title="드래그하여 좌우 비율 조정"
        style={{
          position: 'fixed',
          top: 0,
          left: `calc(${(panelRatio * 100).toFixed(2)}% - 8px)`,
          width: 8,
          height: '100vh',
          cursor: 'col-resize',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          background: 'transparent',
        }}
      >
        <div style={{ width: 2, height: '100%', background: '#ddd', borderRadius: 2 }} />
      </div>

      <DashboardHeader
        cafe={cafe}
        customerUrl={customerUrl}
        isAccepting={isAccepting}
        aiAutoAccept={aiAutoAccept}
        onCafePatch={handleCafePatch}
        onToggleAccepting={toggleAccepting}
        onToggleAiAutoAccept={toggleAiAutoAccept}
        onLogout={onLogout}
      />

      <DashboardTabs activeTab={tab} recommendations={recommendations} onChange={setTab} />

      {tab === 'queue' && (
        <QueueTab
          recommendations={recommendations}
          loading={loading}
          dragOver={dragOver}
          defaultVideo={defaultVideo}
          nowPlaying={nowPlaying}
          widevineStatus={widevineStatus}
          slug={cafe.slug}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragOver(null)}
          onDrop={handleDrop}
          onDropToDefault={handleDropToDefault}
          onSetDefault={handleSetDefault}
          onClearDefault={handleClearDefault}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}

      <HistoryTab
        active={tab === 'history'}
        slug={cafe.slug}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />

      {tab === 'stats' && <StatsPanel />}
      {tab === 'qr' && <QRTab url={customerUrl} cafeName={cafe.name} onSlugChanged={handleSlugChanged} />}
      {tab === 'settings' && (
        <SettingsTab
          allowedPlatforms={allowedPlatforms}
          saving={platformSaving}
          onSave={async platforms => {
            setPlatformSaving(true);
            try {
              const { allowed_platforms } = await updatePlatforms(platforms);
              setAllowedPlatforms(allowed_platforms);
            } catch (error) {
              alert(error.message);
            } finally {
              setPlatformSaving(false);
            }
          }}
        />
      )}
      {tab === 'contact' && <ContactTab provider={cafe.provider} />}
      {tab === 'shortcuts' && <ShortcutsTab />}
    </div>
  );
}
