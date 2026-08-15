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
      setPlatformMessage({ tone: 'success', text: '손님 신청 플랫폼을 저장했어요.' });
    } catch (error) {
      setPlatformMessage({ tone: 'error', text: error.message || '손님 신청 플랫폼을 저장하지 못했어요. 다시 시도해 주세요.' });
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
        description="손님 신청 플랫폼과 AI 필터 기준을 관리해요."
      >
        <div style={settingsStyles.innerSection}>
          <div style={settingsStyles.title}>손님 신청 플랫폼</div>
          <div style={settingsStyles.desc}>손님이 신청곡을 찾을 음악 플랫폼을 선택해 주세요.</div>
          <div style={settingsStyles.platforms}>
            {PLATFORM_OPTIONS.map(p => {
              const active = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  aria-pressed={active}
                  style={{
                    ...settingsStyles.platformBtn,
                    ...(active
                      ? {
                        ...settingsStyles.platformBtnActive,
                        borderColor: p.color,
                        background: p.softColor,
                        color: p.activeText,
                      }
                      : settingsStyles.platformBtnInactive),
                  }}
                >
                  <span style={{ ...settingsStyles.platformDot, background: p.color }} aria-hidden="true" />
                  {p.label}
                </button>
              );
            })}
          </div>
          {selected.length === 1 && (
            <div style={settingsStyles.hint}>손님 신청 플랫폼을 1개 이상 선택해 주세요.</div>
          )}
          <SettingsStatus tone={platformMessage?.tone}>{platformMessage?.text}</SettingsStatus>
          {changed && (
            <button type="button" onClick={handlePlatformSave} disabled={saving} style={settingsStyles.saveBtn}>
              {saving ? '저장 중…' : '저장'}
            </button>
          )}
        </div>
        <MusicFilterSettings />
      </CollapsibleSetting>

      <CollapsibleSetting
        id="owner-store-settings"
        title="매장 정보"
        description="카페명, 공지, 손님용 QR 코드를 관리해요."
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
        description="음악 서비스 로그인과 재생 화면을 열어요."
      >
        <ShortcutsTab />
      </CollapsibleSetting>

      <CollapsibleSetting
        id="owner-account-settings"
        title="계정 및 도움말"
        description="서비스 문의와 이 기기의 로그아웃을 관리해요."
      >
        <ContactTab provider={provider} />
        <div style={settingsStyles.accountActions}>
          <span style={settingsStyles.accountHint}>이 기기의 사장님 계정에서 로그아웃해요.</span>
          <button type="button" onClick={onLogout} style={settingsStyles.logoutBtn}>로그아웃</button>
        </div>
      </CollapsibleSetting>

      {import.meta.env.DEV && (
        <CollapsibleSetting
          id="owner-advanced-settings"
          title="개발자 도구"
          description="개발 환경에서 재생 문제를 진단해요."
        >
          <button
            type="button"
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
  title:       { fontSize: 15, fontWeight: 700, color: 'var(--owner-text-strong)', marginBottom: 4 },
  desc:        { fontSize: 12, color: 'var(--owner-text-muted)', marginBottom: 14 },
  platforms:   { display: 'flex', gap: 8, flexWrap: 'wrap' },
  platformBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 40, padding: '9px 14px', borderRadius: 8, border: '1px solid', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  platformBtnActive: { fontWeight: 700 },
  platformBtnInactive: { background: '#fff', color: 'var(--owner-text-muted)', borderColor: 'var(--owner-stroke)' },
  platformDot: { width: 8, height: 8, flex: '0 0 8px', borderRadius: 999 },
  hint:        { fontSize: 12, color: '#9c6500', marginTop: 8 },
  saveBtn:     { minHeight: 40, marginTop: 16, padding: '9px 20px', borderRadius: 8, background: 'var(--owner-primary)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 650, fontSize: 13 },
  logoutBtn:   { minHeight: 40, padding: '9px 16px', borderRadius: 8, border: '1px solid var(--owner-stroke)', background: '#fff', color: 'var(--owner-text)', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  details:     { background: '#fff', borderRadius: 12, border: '1px solid var(--owner-stroke)', overflow: 'hidden' },
  summary:     { display: 'flex', flexDirection: 'column', gap: 4, padding: 16, cursor: 'pointer', listStylePosition: 'inside' },
  summaryTitle:{ fontSize: 15, fontWeight: 700, color: 'var(--owner-text-strong)' },
  summaryDesc: { fontSize: 12, color: 'var(--owner-text-muted)', lineHeight: 1.45 },
  detailsContent: { borderTop: '1px solid var(--owner-stroke)', padding: '16px' },
  divider:     { height: 1, background: 'var(--owner-stroke)', margin: '20px 0 4px' },
  accountActions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingTop: 16, borderTop: '1px solid var(--owner-stroke)' },
  accountHint: { fontSize: 12, color: 'var(--owner-text-muted)', lineHeight: 1.45 },
};
