import { useEffect, useMemo, useState } from 'react';
import { getMe, updateMusicFilter } from '../../api';

const DEFAULT_PROMPT = '조용한 작업 카페입니다. 잔잔한 재즈, 로파이, 어쿠스틱, 부드러운 팝은 허용하고, 욕설이 많은 곡, 클럽 음악, 과하게 시끄러운 힙합/EDM은 거절해주세요.';

const STRICTNESS = [
  { id: 'low', label: '느슨하게', desc: '명확히 안 맞는 곡만 거절' },
  { id: 'medium', label: '보통', desc: '분위기와 안 맞으면 거절' },
  { id: 'high', label: '엄격하게', desc: '조금만 충돌해도 거절' },
];

function normalize(latest = {}) {
  return {
    enabled: !!latest.music_filter_enabled,
    prompt: latest.music_filter_prompt || '',
    strictness: latest.music_filter_strictness || 'medium',
  };
}

export default function MusicFilterSettings() {
  const [initial, setInitial] = useState(normalize());
  const [form, setForm] = useState(normalize());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    getMe()
      .then(latest => {
        const next = normalize(latest);
        setInitial(next);
        setForm(next);
      })
      .catch(() => setMessage('AI 필터 설정을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  const changed = useMemo(() => JSON.stringify(initial) !== JSON.stringify(form), [initial, form]);
  const canSave = changed && !saving && (!form.enabled || form.prompt.trim().length > 0);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setMessage('');
    try {
      const updated = await updateMusicFilter({
        enabled: form.enabled,
        prompt: form.prompt.trim() || null,
        strictness: form.strictness,
      });
      const next = normalize(updated);
      setInitial(next);
      setForm(next);
      setMessage('AI 음악 필터 설정을 저장했습니다.');
    } catch (e) {
      setMessage(e.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={styles.section}>
        <div style={styles.title}>AI 음악 필터</div>
        <div style={styles.desc}>불러오는 중...</div>
      </div>
    );
  }

  return (
    <div style={styles.section}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.title}>AI 음악 필터</div>
          <div style={styles.desc}>손님 신청곡이 매장 분위기에 맞는지 AI가 수락/거절만 판단합니다.</div>
        </div>
        <button
          onClick={() => setForm(prev => ({ ...prev, enabled: !prev.enabled }))}
          style={{ ...styles.toggle, ...(form.enabled ? styles.toggleOn : styles.toggleOff) }}
        >
          {form.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <label style={styles.label}>매장 분위기 설명</label>
      <textarea
        value={form.prompt}
        onChange={e => setForm(prev => ({ ...prev, prompt: e.target.value }))}
        placeholder={DEFAULT_PROMPT}
        maxLength={1000}
        rows={6}
        style={styles.textarea}
      />
      <div style={styles.count}>{form.prompt.length}/1000</div>
      {form.enabled && !form.prompt.trim() && (
        <div style={styles.warn}>AI 필터를 켜려면 매장 분위기 설명이 필요합니다.</div>
      )}

      <label style={styles.label}>필터 강도</label>
      <div style={styles.strictnessRow}>
        {STRICTNESS.map(item => {
          const active = form.strictness === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setForm(prev => ({ ...prev, strictness: item.id }))}
              style={{ ...styles.strictnessBtn, ...(active ? styles.strictnessActive : {}) }}
            >
              <strong>{item.label}</strong>
              <span>{item.desc}</span>
            </button>
          );
        })}
      </div>

      <div style={styles.info}>
        AI 판단 실패, API 오류, 응답 파싱 실패가 발생하면 매장 분위기 보호를 위해 신청곡은 자동 거절됩니다. 이 경우 사장님 앱에 알림이 표시됩니다.
      </div>

      <div style={styles.actions}>
        {message && <span style={message.includes('저장했습니다') ? styles.okMsg : styles.errMsg}>{message}</span>}
        <button onClick={() => setForm(initial)} disabled={!changed || saving} style={styles.cancelBtn}>되돌리기</button>
        <button onClick={handleSave} disabled={!canSave} style={{ ...styles.saveBtn, ...(!canSave ? styles.disabledBtn : {}) }}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}

const styles = {
  section: { background: '#f8f8f8', borderRadius: 12, padding: 20 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 },
  title: { fontSize: 15, fontWeight: 700, marginBottom: 4 },
  desc: { fontSize: 13, color: '#888', lineHeight: 1.45 },
  toggle: { minWidth: 58, padding: '8px 14px', borderRadius: 999, border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 13 },
  toggleOn: { background: '#4caf50' },
  toggleOff: { background: '#aaa' },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#555', marginTop: 14, marginBottom: 8 },
  textarea: { width: '100%', boxSizing: 'border-box', fontSize: 13, lineHeight: 1.5, padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', outline: 'none', resize: 'vertical', fontFamily: 'sans-serif', background: '#fff' },
  count: { fontSize: 11, color: '#aaa', textAlign: 'right', marginTop: 4 },
  warn: { fontSize: 12, color: '#e63946', marginTop: 6 },
  strictnessRow: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 },
  strictnessBtn: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', padding: 10, borderRadius: 10, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#777' },
  strictnessActive: { borderColor: '#1a1a2e', color: '#1a1a2e', boxShadow: '0 0 0 1px #1a1a2e inset' },
  info: { marginTop: 14, padding: 12, borderRadius: 8, background: '#fff7e6', color: '#8a5a00', fontSize: 12, lineHeight: 1.45 },
  actions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 16, flexWrap: 'wrap' },
  okMsg: { marginRight: 'auto', fontSize: 12, color: '#4caf50' },
  errMsg: { marginRight: 'auto', fontSize: 12, color: '#e63946' },
  cancelBtn: { padding: '9px 14px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', color: '#777', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  saveBtn: { padding: '10px 24px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  disabledBtn: { opacity: 0.5, cursor: 'not-allowed' },
};
