import { useState, useEffect } from 'react';
import MusicFilterSettings from './MusicFilterSettings';
import QRTab from './QRTab';
import ContactTab from './ContactTab';
import ShortcutsTab from './ShortcutsTab';
import CafeProfileSettings from './CafeProfileSettings';
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
  onSlugChanged,
  onSave,
}) {
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
  wrap:        { paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 16 },
  innerSection:{ paddingBottom: 20, marginBottom: 20, borderBottom: '1px solid #eee' },
  title:       { fontSize: 15, fontWeight: 700, marginBottom: 4 },
  desc:        { fontSize: 13, color: '#888', marginBottom: 16 },
  platforms:   { display: 'flex', gap: 10, flexWrap: 'wrap' },
  platformBtn: { padding: '10px 20px', borderRadius: 10, border: '2px solid', fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' },
  hint:        { fontSize: 12, color: '#ff9800', marginTop: 8 },
  saveBtn:     { marginTop: 16, padding: '10px 28px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  logoutBtn:   { padding: '9px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', color: '#555', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  details:     { background: '#f8f8f8', borderRadius: 12, border: '1px solid #eee', overflow: 'hidden' },
  summary:     { display: 'flex', flexDirection: 'column', gap: 4, padding: 20, cursor: 'pointer', listStylePosition: 'inside' },
  summaryTitle:{ fontSize: 15, fontWeight: 700, color: '#222' },
  summaryDesc: { fontSize: 13, color: '#888', lineHeight: 1.4 },
  detailsContent: { borderTop: '1px solid #eee', padding: '4px 20px 20px' },
  divider:     { height: 1, background: '#eee', margin: '20px 0 4px' },
  accountActions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 16, borderTop: '1px solid #eee' },
  accountHint: { fontSize: 12, color: '#888', lineHeight: 1.4 },
};
