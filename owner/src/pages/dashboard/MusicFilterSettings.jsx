import { useEffect, useMemo, useState } from 'react';
import { getMe, testMusicFilter, updateMusicFilter } from '../../api';
import { DEFAULT_MUSIC_FILTER_PROMPT } from '../../constants/musicFilterPolicy';
import SettingsStatus from './SettingsStatus';

// ON/OFF는 대시보드의 'AI 자동수락' 버튼이 담당 — 이 화면은 프롬프트만 편집한다.
function normalize(latest = {}) {
  return {
    prompt: latest.music_filter_prompt || '',
  };
}

function TestResultCard({ result }) {
  if (!result) {
    return (
      <div style={styles.testEmpty}>
        테스트를 실행하면 현재 매장 분위기 설명을 기준으로 AI 판단 결과를 보여줘요.
      </div>
    );
  }

  const accepted = result.decision === 'accept';
  const rejected = result.decision === 'reject';

  return (
    <div style={{ ...styles.testResult, ...(accepted ? styles.acceptResult : rejected ? styles.rejectResult : {}) }}>
      <div style={styles.resultTopRow}>
        <span style={styles.resultBadge}>{accepted ? '신청 가능' : rejected ? '신청 불가' : result.decision}</span>
      </div>
      <div style={styles.reason}>{result.reason || '판단 사유가 없어요.'}</div>
      {result.track && (
        <div style={styles.trackMeta}>
          {[result.track.platform, result.track.title, result.track.channelTitle].filter(Boolean).join(' · ')}
        </div>
      )}
      {result.model && <div style={styles.modelMeta}>모델: {result.model}</div>}
    </div>
  );
}

export default function MusicFilterSettings() {
  const [initial, setInitial] = useState(normalize());
  const [form, setForm] = useState(normalize());
  const [enabled, setEnabled] = useState(false); // 서버의 현재 AI 자동수락 상태 (읽기 전용 표시)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [testUrl, setTestUrl] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => {
    getMe()
      .then(latest => {
        const next = normalize(latest);
        setInitial(next);
        setForm(next);
        setEnabled(!!latest.music_filter_enabled);
      })
      .catch(() => setMessage({ tone: 'error', text: 'AI 자동수락 설정을 불러오지 못했어요. 다시 시도해 주세요.' }))
      .finally(() => setLoading(false));
  }, []);

  const changed = useMemo(() => JSON.stringify(initial) !== JSON.stringify(form), [initial, form]);
  // AI 자동수락이 켜져 있으면 프롬프트를 비운 채로 저장할 수 없다 (서버가 400 반환)
  const canSave = changed && !saving && (!enabled || form.prompt.trim().length > 0);
  const canTest = !testLoading && testUrl.trim().length > 0 && form.prompt.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setMessage(null);
    try {
      // enabled는 이 화면에서 바꾸지 않는다 — 대시보드 토글과 어긋나지 않도록
      // 저장 직전 서버의 최신 값을 읽어 그대로 전달한다.
      const latest = await getMe();
      const latestEnabled = !!latest.music_filter_enabled;
      if (latestEnabled && !form.prompt.trim()) {
        setEnabled(latestEnabled);
        setMessage({ tone: 'error', text: 'AI 자동수락이 켜져 있어 매장 분위기 설명을 비울 수 없어요.' });
        return;
      }
      const updated = await updateMusicFilter({
        enabled: latestEnabled,
        prompt: form.prompt.trim() || null,
      });
      const next = normalize(updated);
      setInitial(next);
      setForm(next);
      setEnabled(!!updated.music_filter_enabled);
      setMessage({ tone: 'success', text: '매장 분위기 설명을 저장했어요.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error.message || '매장 분위기 설명을 저장하지 못했어요. 다시 시도해 주세요.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!canTest) return;
    setTestLoading(true);
    setTestMessage('');
    setTestResult(null);

    try {
      const result = await testMusicFilter({
        url: testUrl.trim(),
        prompt: form.prompt.trim(),
      });
      setTestResult(result);
    } catch (error) {
      setTestMessage(error.message || 'AI 판단을 테스트하지 못했어요. 곡 링크를 확인하고 다시 시도해 주세요.');
    } finally {
      setTestLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={styles.section}>
        <div style={styles.title}>AI 자동수락</div>
        <div style={styles.desc}>AI 자동수락 설정을 불러오고 있어요.</div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.section}>
        <div style={styles.headerRow}>
          <div>
            <div style={styles.title}>AI 자동수락</div>
            <div style={styles.desc}>
              매장 분위기 설명을 기준으로 새 신청을 확인하고, 기준에 맞는 곡을 대기 곡으로 옮겨요.
            </div>
          </div>
          <span style={{ ...styles.stateBadge, ...(enabled ? styles.stateOn : styles.stateOff) }}>
            {enabled ? 'AI 자동수락 켜짐' : 'AI 자동수락 꺼짐'}
          </span>
        </div>

        <label style={styles.label}>매장 분위기 설명</label>
        <textarea
          value={form.prompt}
          onChange={event => setForm(prev => ({ ...prev, prompt: event.target.value }))}
          placeholder={DEFAULT_MUSIC_FILTER_PROMPT}
          maxLength={1000}
          rows={6}
          style={styles.textarea}
        />
        <div style={styles.count}>{form.prompt.length}/1000</div>
        {enabled && !form.prompt.trim() && (
          <div style={styles.warn}>AI 자동수락이 켜져 있어 매장 분위기 설명을 비울 수 없어요.</div>
        )}

        <div style={styles.info}>
          AI 판단 중 문제가 발생하면 신청곡은 자동으로 거절돼요. 결과는 이력에서 확인할 수 있어요.
        </div>

        <div style={styles.actions}>
          <SettingsStatus tone={message?.tone}>{message?.text}</SettingsStatus>
          <button type="button" onClick={() => setForm(initial)} disabled={!changed || saving} style={styles.cancelBtn}>되돌리기</button>
          <button type="button" onClick={handleSave} disabled={!canSave} style={{ ...styles.saveBtn, ...(!canSave ? styles.disabledBtn : {}) }}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>

      <details style={styles.advancedSection}>
        <summary style={styles.advancedSummary}>AI 판단 테스트</summary>
        <div style={styles.advancedBody}>
          <div style={styles.headerRow}>
            <div style={styles.desc}>곡 링크를 입력해 현재 매장 분위기 설명으로 내린 판단을 미리 확인해요.</div>
            <span style={styles.badge}>OpenRouter</span>
          </div>

          <label style={styles.label}>테스트 곡 URL</label>
          <div style={styles.testInputRow}>
            <input
              type="url"
              value={testUrl}
              onChange={event => {
                setTestUrl(event.target.value);
                setTestMessage('');
                setTestResult(null);
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              style={styles.input}
            />
            <button type="button" onClick={handleTest} disabled={!canTest} style={{ ...styles.testBtn, ...(!canTest ? styles.disabledBtn : {}) }}>
              {testLoading ? '테스트 중…' : '테스트하기'}
            </button>
          </div>

          {!form.prompt.trim() && (
            <div style={styles.warn}>테스트하려면 먼저 매장 분위기 설명을 입력해 주세요.</div>
          )}
          {testMessage && <div style={styles.testNotice}>{testMessage}</div>}

          <TestResultCard result={testResult} />
        </div>
      </details>
    </div>
  );
}

const styles = {
  wrapper: { display: 'grid', gap: 16 },
  section: { padding: '4px 0' },
  advancedSection: { background: '#fff', border: '1px solid #e4e7ec', borderRadius: 8, overflow: 'hidden' },
  advancedSummary: { padding: '14px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#475467' },
  advancedBody: { padding: '2px 14px 14px', borderTop: '1px solid #e4e7ec' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  title: { fontSize: 15, fontWeight: 700, color: 'var(--owner-text-strong)', marginBottom: 4 },
  desc: { fontSize: 12, color: 'var(--owner-text-muted)', lineHeight: 1.45 },
  stateBadge: { flexShrink: 0, padding: '6px 10px', borderRadius: 999, border: '1px solid', fontWeight: 800, fontSize: 11 },
  stateOn: { borderColor: '#cfe0fb', background: '#eef5ff', color: 'var(--owner-primary-hover)' },
  stateOff: { borderColor: 'var(--owner-stroke)', background: 'var(--owner-surface-subtle)', color: 'var(--owner-text-muted)' },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: '#475467', marginTop: 14, marginBottom: 8 },
  textarea: { width: '100%', boxSizing: 'border-box', fontSize: 13, lineHeight: 1.5, padding: '10px 12px', borderRadius: 8, border: '1px solid #d0d5dd', outline: 'none', resize: 'vertical', fontFamily: 'sans-serif', background: '#fff' },
  count: { fontSize: 11, color: '#98a2b3', textAlign: 'right', marginTop: 4 },
  warn: { fontSize: 12, color: '#b42318', marginTop: 6 },
  info: { marginTop: 14, padding: 12, borderRadius: 8, border: '1px solid #e4e7ec', background: '#f9fafb', color: '#667085', fontSize: 12, lineHeight: 1.45 },
  actions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 16, flexWrap: 'wrap' },
  cancelBtn: { minHeight: 40, padding: '9px 14px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#fff', color: '#667085', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  saveBtn: { minHeight: 40, padding: '9px 20px', borderRadius: 8, background: 'var(--owner-primary)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  disabledBtn: { opacity: 0.5, cursor: 'not-allowed' },
  badge: { flexShrink: 0, padding: '5px 9px', borderRadius: 999, background: '#eee', color: '#777', fontSize: 11, fontWeight: 700 },
  testInputRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  input: { flex: '1 1 200px', width: '100%', minHeight: 40, boxSizing: 'border-box', fontSize: 13, padding: '9px 12px', borderRadius: 8, border: '1px solid #d0d5dd', outline: 'none', background: '#fff' },
  testBtn: { minHeight: 40, padding: '9px 14px', borderRadius: 8, background: 'var(--owner-primary)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' },
  testNotice: { marginTop: 10, padding: 10, borderRadius: 8, background: '#fff1f1', color: '#b42318', fontSize: 12, lineHeight: 1.45 },
  testEmpty: { marginTop: 12, padding: 14, borderRadius: 10, border: '1px dashed #ddd', background: '#fff', color: '#999', fontSize: 12, lineHeight: 1.45 },
  testResult: { marginTop: 12, padding: 14, borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontSize: 13 },
  acceptResult: { borderColor: '#b7dfb9', background: '#f3fbf3' },
  rejectResult: { borderColor: '#f1c1c1', background: '#fff5f5' },
  resultTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  resultBadge: { fontSize: 12, fontWeight: 800, color: '#1a1a2e' },
  reason: { color: '#333', lineHeight: 1.5 },
  trackMeta: { marginTop: 8, color: '#888', fontSize: 12, lineHeight: 1.4 },
  modelMeta: { marginTop: 4, color: '#aaa', fontSize: 11, lineHeight: 1.4 },
};
