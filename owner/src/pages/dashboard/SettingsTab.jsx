import { useState, useEffect } from 'react';
import MusicFilterSettings from './MusicFilterSettings';
import QRTab from './QRTab';
import ContactTab from './ContactTab';
import ShortcutsTab from './ShortcutsTab';
import CafeProfileSettings from './CafeProfileSettings';
import SettingsStatus from './SettingsStatus';
import OwnerOnboarding from './OwnerOnboarding';
import { PLATFORM_OPTIONS } from '../../constants/platforms';

function CollapsibleSetting({ id, title, description, children }) {
  return (
    <details id={id} style={settingsStyles.details}>
      <summary style={settingsStyles.summary}>
        <span style={settingsStyles.summaryTitle}>{title}</span>
        <span style={settingsStyles.summaryDesc}>{description}</span>
      </summary>
      <div style={settingsStyles.detailsContent}>{children}</div>
    </details>
  );
}

export default function SettingsTab({
  allowedPlatforms,
  saving,
  customerUrl,
  cafeName,
  currentSlug,
  initialSlug,
  provider,
  cafe,
  onCafePatch,
  onLogout,
  defaultVideo,
  aiAutoAccept,
  onOpenQueue,
  onSlugChanged,
  onSave,
}) {
  const [selected, setSelected] = useState(allowedPlatforms);
  const [platformMessage, setPlatformMessage] = useState(null);

  useEffect(() => { setSelected(allowedPlatforms); }, [allowedPlatforms]);

  function toggle(id) {
    setPlatformMessage(null);
    setSelected(prev => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev; // 최소 1개
        return prev.filter(p => p !== id);
      }
      return [...prev, id];
    });
  }

  const changed = JSON.stringify([...selected].sort()) !== JSON.stringify([...allowedPlatforms].sort());

  async function handlePlatformSave() {
    setPlatformMessage(null);
    try {
      await onSave(selected);
      setPlatformMessage({ tone: 'success', text: '허용 플랫폼을 저장했습니다.' });
    } catch (error) {
      setPlatformMessage({ tone: 'error', text: error.message || '허용 플랫폼을 저장하지 못했습니다.' });
    }
  }

  return (
    <div style={settingsStyles.wrap}>
      <OwnerOnboarding
        hasDefaultBgm={!!defaultVideo}
        allowedPlatformCount={selected.length}
        aiAutoAccept={aiAutoAccept}
        onOpenQueue={onOpenQueue}
      />

      <CollapsibleSetting
        id="owner-operation-settings"
        title="운영 설정"
        description="신청 플랫폼과 AI 자동 재생 기준을 관리합니다."
      >
        <div style={settingsStyles.innerSection}>
          <div style={settingsStyles.title}>허용 플랫폼</div>
          <div style={settingsStyles.desc}>손님이 신청할 수 있는 음악 플랫폼을 선택하세요.</div>
          <div style={settingsStyles.platforms}>
            {PLATFORM_OPTIONS.map(p => {
              const active = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  aria-pressed={active}
                  style={{
                    ...settingsStyles.platformBtn,
                    ...(active
                      ? settingsStyles.platformBtnActive
                      : settingsStyles.platformBtnInactive),
                  }}
                >
                  {active ? '✓ ' : ''}{p.label}
                </button>
              );
            })}
          </div>
          {selected.length === 1 && (
            <div style={settingsStyles.hint}>최소 1개 플랫폼은 활성화해야 합니다.</div>
          )}
          <SettingsStatus tone={platformMessage?.tone}>{platformMessage?.text}</SettingsStatus>
          {changed && (
            <button onClick={handlePlatformSave} disabled={saving} style={settingsStyles.saveBtn}>
              {saving ? '저장 중...' : '저장'}
            </button>
          )}
        </div>
        <MusicFilterSettings />
      </CollapsibleSetting>

      <CollapsibleSetting
        id="owner-store-settings"
        title="매장 정보"
        description="카페명, 공지, 손님용 QR 코드를 관리합니다."
      >
        <CafeProfileSettings cafe={cafe} onCafePatch={onCafePatch} />
        <div style={settingsStyles.divider} />
        <QRTab
          url={customerUrl}
          cafeName={cafeName}
          currentSlug={currentSlug}
          initialSlug={initialSlug}
          onSlugChanged={onSlugChanged}
        />
      </CollapsibleSetting>

      <CollapsibleSetting
        id="owner-music-service-settings"
        title="음악 서비스"
        description="플랫폼 로그인과 BGM 페이지를 엽니다."
      >
        <ShortcutsTab />
      </CollapsibleSetting>

      <CollapsibleSetting
        id="owner-account-settings"
        title="계정 및 도움말"
        description="서비스 문의와 이 기기의 로그아웃을 관리합니다."
      >
        <ContactTab provider={provider} />
        <div style={settingsStyles.accountActions}>
          <span style={settingsStyles.accountHint}>이 기기의 사장님 계정에서 로그아웃합니다.</span>
          <button onClick={onLogout} style={settingsStyles.logoutBtn}>로그아웃</button>
        </div>
      </CollapsibleSetting>

      {import.meta.env.DEV && (
        <CollapsibleSetting
          id="owner-advanced-settings"
          title="개발자 도구"
          description="개발 환경에서 재생 문제를 진단합니다."
        >
          <button
            onClick={() => window.electronAPI?.openBgmDevTools()}
            style={settingsStyles.saveBtn}
          >BGM DevTools 열기</button>
        </CollapsibleSetting>
      )}
    </div>
  );
}

const settingsStyles = {
  wrap:        { paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 12 },
  innerSection:{ paddingBottom: 20, marginBottom: 20, borderBottom: '1px solid #eee' },
  title:       { fontSize: 14, fontWeight: 700, color: '#344054', marginBottom: 4 },
  desc:        { fontSize: 12, color: '#667085', marginBottom: 14 },
  platforms:   { display: 'flex', gap: 8, flexWrap: 'wrap' },
  platformBtn: { minHeight: 40, padding: '9px 14px', borderRadius: 8, border: '1px solid', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  platformBtnActive: { background: '#1f2937', color: '#fff', borderColor: '#1f2937' },
  platformBtnInactive: { background: '#fff', color: '#667085', borderColor: '#d0d5dd' },
  hint:        { fontSize: 12, color: '#8a5d00', marginTop: 8 },
  saveBtn:     { minHeight: 40, marginTop: 16, padding: '9px 20px', borderRadius: 8, background: '#1f2937', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  logoutBtn:   { minHeight: 40, padding: '9px 16px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#fff', color: '#475467', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  details:     { background: '#fff', borderRadius: 10, border: '1px solid #e4e7ec', overflow: 'hidden' },
  summary:     { display: 'flex', flexDirection: 'column', gap: 4, padding: 16, cursor: 'pointer', listStylePosition: 'inside' },
  summaryTitle:{ fontSize: 15, fontWeight: 700, color: '#1f2937' },
  summaryDesc: { fontSize: 12, color: '#667085', lineHeight: 1.45 },
  detailsContent: { borderTop: '1px solid #e4e7ec', padding: '16px' },
  divider:     { height: 1, background: '#e4e7ec', margin: '20px 0 4px' },
  accountActions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingTop: 16, borderTop: '1px solid #e4e7ec' },
  accountHint: { fontSize: 12, color: '#667085', lineHeight: 1.45 },
};
