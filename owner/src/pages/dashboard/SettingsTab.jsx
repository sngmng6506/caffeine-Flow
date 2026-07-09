import { useState, useEffect } from 'react';
import MusicFilterSettings from './MusicFilterSettings';
import { PLATFORM_OPTIONS } from '../../constants/platforms';

export default function SettingsTab({ allowedPlatforms, saving, onSave }) {
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
