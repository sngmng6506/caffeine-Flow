import { useState } from 'react';
import { updatePlatforms } from '../api';
import { VALID_PLATFORMS } from '../constants/platforms';
import SettingsTab from './dashboard/SettingsTab';
import DashboardHeader from './dashboard/DashboardHeader';
import DashboardTabs from './dashboard/DashboardTabs';
import QueueTab from './dashboard/QueueTab';
import HistoryTab from './dashboard/HistoryTab';
import useRecommendationQueue from './dashboard/useRecommendationQueue';
import usePanelDivider from './dashboard/usePanelDivider';
import useQueueDragAndDrop from './dashboard/useQueueDragAndDrop';
import { clearSavedBgm, readSavedBgm, saveSavedBgm, savedToBgmUrl } from './dashboard/bgmStorage';
import { REC_STATUS } from '../constants/recommendationStatus';
import { requestClearBgm, requestSetBgmUrl } from './dashboard/bgmBridge.mjs';

const COLLAPSED_PANEL_WIDTH = 48;

function CollapsedPanelRail({ isAccepting, isAcceptingReady, aiFilterEnabled, aiFilterReady, hasUpdate, onExpand }) {
  const acceptingLabel = isAcceptingReady
    ? (isAccepting ? '신청 받는 중' : '신청 닫힘')
    : '신청 상태 확인 중';
  const aiFilterLabel = aiFilterReady
    ? (aiFilterEnabled ? 'AI 필터 켜짐' : 'AI 필터 꺼짐')
    : 'AI 필터 상태 확인 중';

  return (
    <aside className="owner-panel-rail" aria-label="운영 상태 요약">
      <button
        type="button"
        autoFocus
        onClick={onExpand}
        className="owner-panel-rail__expand"
        aria-label={`사장님 화면 펼치기${hasUpdate ? ', 업데이트 있음' : ''}`}
        title="사장님 화면 펼치기"
      >
        <span aria-hidden="true">›</span>
        {hasUpdate && <span className="owner-panel-rail__update" aria-hidden="true" />}
      </button>
      <div className="owner-panel-rail__statuses">
        <span className="owner-panel-rail__status" aria-label={acceptingLabel} title={acceptingLabel} aria-busy={!isAcceptingReady}>
          <span className={`owner-panel-rail__dot ${isAcceptingReady && isAccepting ? 'owner-panel-rail__dot--success' : ''}`} aria-hidden="true" />
          <span>신청</span>
        </span>
        <span className="owner-panel-rail__status" aria-label={aiFilterLabel} title={aiFilterLabel} aria-busy={!aiFilterReady}>
          <span className={`owner-panel-rail__dot ${aiFilterReady && aiFilterEnabled ? 'owner-panel-rail__dot--success' : ''}`} aria-hidden="true" />
          <span>AI</span>
        </span>
      </div>
    </aside>
  );
}

export default function DashboardPage({ cafe: initialCafe, onLogout, updateBanner }) {
  const [cafe, setCafe] = useState(initialCafe);
  const [defaultVideo, setDefaultVideo] = useState(() => readSavedBgm(initialCafe.id));
  const [tab, setTab] = useState('queue');
  const [allowedPlatforms, setAllowedPlatforms] = useState(VALID_PLATFORMS);
  const [platformSaving, setPlatformSaving] = useState(false);
  const [customerUrl, setCustomerUrl] = useState('');
  const {
    panelRatio,
    isPanelCollapsed,
    supportsPanelCollapse,
    collapsePanel,
    expandPanel,
    handleDividerMouseDown,
  } = usePanelDivider();

  const {
    recommendations,
    setRecommendations,
    isAccepting,
    nowPlaying,
    currentTrack,
    loading,
    widevineStatus,
    aiAutoAccept,
    isAcceptingReady,
    aiFilterReady,
    canControlPlayback,
    toggleAccepting,
    toggleAiAutoAccept,
    finishPlaybackForExit,
    handleUpdate,
    handleDelete,
  } = useRecommendationQueue({
    cafe,
    setCafe,
    setAllowedPlatforms,
    setCustomerUrl,
    onPromptRequired: () => setTab('settings'),
  });

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
      const next = {
        ...previous,
        slug: updated.slug,
        initial_slug: updated.initial_slug || previous.initial_slug,
      };
      localStorage.setItem('cafe', JSON.stringify(next));
      return next;
    });
    setCustomerUrl(updated.customer_url);
  }

  async function handleSetDefault(info) {
    if (recommendations.some(rec => rec.status === REC_STATUS.PLAYING)) {
      throw new Error('신청곡 재생이 끝난 뒤 기본 BGM을 설정할 수 있어요.');
    }
    const url = savedToBgmUrl(info);
    if (url && !await requestSetBgmUrl(window.electronAPI, url)) {
      throw new Error('신청곡 재생이 시작되어 기본 BGM을 변경하지 않았어요.');
    }
    setDefaultVideo(info);
    saveSavedBgm(cafe.id, info);
  }

  async function handleClearDefault() {
    if (recommendations.some(rec => rec.status === REC_STATUS.PLAYING)) {
      throw new Error('신청곡 재생이 끝난 뒤 기본 BGM을 해제할 수 있어요.');
    }
    if (!await requestClearBgm(window.electronAPI)) {
      throw new Error('신청곡 재생이 시작되어 기본 BGM을 해제하지 않았어요.');
    }
    setDefaultVideo(null);
    clearSavedBgm(cafe.id);
  }

  async function handleLogout() {
    try {
      await finishPlaybackForExit();
    } catch (error) {
      console.error('[logout playback cleanup]', error);
    } finally {
      onLogout();
    }
  }

  const {
    dragOver,
    clearDragOver,
    handleDragOver,
    handleDrop,
    handleDropToDefault,
    error: queueError,
  } = useQueueDragAndDrop({
    cafeSlug: cafe.slug,
    recommendations,
    setRecommendations,
    onRecommendationUpdate: handleUpdate,
    onSetDefault: handleSetDefault,
    onClearDefault: handleClearDefault,
    canControlPlayback,
  });

  return (
    <div
      className={`owner-dashboard ${isPanelCollapsed ? 'owner-dashboard--collapsed' : ''}`}
      style={{ width: isPanelCollapsed ? COLLAPSED_PANEL_WIDTH : `${(panelRatio * 100).toFixed(2)}vw` }}
    >
      {isPanelCollapsed && (
        <CollapsedPanelRail
          isAccepting={isAccepting}
          isAcceptingReady={isAcceptingReady}
          aiFilterEnabled={aiAutoAccept}
          aiFilterReady={aiFilterReady}
          hasUpdate={Boolean(updateBanner)}
          onExpand={expandPanel}
        />
      )}

      <div className="owner-dashboard__content" hidden={isPanelCollapsed}>
        {updateBanner}
        {/* BrowserView 경계보다 8px 왼쪽에 renderer 드래그 영역을 둔다. */}
        <div
          className="owner-panel-divider"
          onMouseDown={handleDividerMouseDown}
          title="드래그하여 좌우 폭 조정"
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
          <div className="owner-panel-divider-line" />
        </div>

      <DashboardHeader
        cafe={cafe}
        isAccepting={isAccepting}
        isAcceptingReady={isAcceptingReady}
        aiAutoAccept={aiAutoAccept}
        aiFilterReady={aiFilterReady}
        onToggleAccepting={toggleAccepting}
        onToggleAiAutoAccept={toggleAiAutoAccept}
        canCollapsePanel={supportsPanelCollapse}
        onCollapsePanel={collapsePanel}
      />

      <DashboardTabs activeTab={tab} recommendations={recommendations} onChange={setTab} />

      {tab === 'queue' && (
        <QueueTab
          recommendations={recommendations}
          loading={loading}
          dragOver={dragOver}
          defaultVideo={defaultVideo}
          nowPlaying={nowPlaying}
          currentTrack={currentTrack}
          widevineStatus={widevineStatus}
          slug={cafe.slug}
          error={queueError}
          canControlPlayback={canControlPlayback}
          onDragOver={handleDragOver}
          onDragLeave={clearDragOver}
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

      {tab === 'settings' && (
        <SettingsTab
          allowedPlatforms={allowedPlatforms}
          saving={platformSaving}
          customerUrl={customerUrl}
          cafeName={cafe.name}
          currentSlug={cafe.slug}
          initialSlug={cafe.initial_slug}
          provider={cafe.provider}
          cafe={cafe}
          onCafePatch={handleCafePatch}
          onLogout={handleLogout}
          defaultVideo={defaultVideo}
          aiAutoAccept={aiAutoAccept}
          onOpenQueue={() => setTab('queue')}
          onSlugChanged={handleSlugChanged}
          onSave={async platforms => {
            setPlatformSaving(true);
            try {
              const { allowed_platforms } = await updatePlatforms(platforms);
              setAllowedPlatforms(allowed_platforms);
            } finally {
              setPlatformSaving(false);
            }
          }}
        />
      )}
      </div>
    </div>
  );
}
