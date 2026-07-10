import { useEffect, useMemo, useState } from 'react';
import { getMe, testMusicFilter, updateMusicFilter } from '../../api';
import {
  DEFAULT_MUSIC_FILTER_PROMPT,
  DEFAULT_MUSIC_FILTER_STRICTNESS,
  MUSIC_FILTER_STRICTNESS_OPTIONS,
} from '../../constants/musicFilterPolicy';

function normalize(latest = {}) {
  return {
    enabled: !!latest.music_filter_enabled,
    prompt: latest.music_filter_prompt || '',
    strictness: latest.music_filter_strictness || DEFAULT_MUSIC_FILTER_STRICTNESS,
  };
}

function confidenceLabel(value) {
  if (typeof value !== 'number') return '-';
  return `${Math.round(value * 100)}%`;
}

function TestResultCard({ result }) {
  if (!result) {
    return (
      <div style={styles.testEmpty}>
        테스트를 실행하면 현재 화면의 매장 분위기 설명과 필터 강도를 기준으로 AI 판단 결과가 표시됩니다.
      </div>
    );
  }

  const accepted = result.decision === 'accept';
  const rejected = result.decision === 'reject';

  return (
    <div style={{ ...styles.testResult, ...(accepted ? styles.acceptResult : rejected ? styles.rejectResult : {}) }}>
      <div style={styles.resultTopRow}>
        <span style={styles.resultBadge}>{accepted ? '수락' : rejected ? '거절' : result.decision}</span>
        <span style={styles.confidence}>신뢰도 {confidenceLabel(result.confidence)}</span>
      </div>
      <div style={styles.reason}>{result.reason || '판단 사유가 없습니다.'}</div>
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
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
      })
      .catch(() => setMessage('AI 필터 설정을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  const changed = useMemo(() => JSON.stringify(initial) !== JSON.stringify(form), [initial, form]);
  const canSave = changed && !saving && (!form.enabled || form.prompt.trim().length > 0);
  const canTest = !testLoading && testUrl.trim().length > 0 && form.prompt.trim().length > 0;

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
    } catch (error) {
      setMessage(error.message || '저장 실패');
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
        strictness: form.strictness,
      });
      setTestResult(result);
    } catch (error) {
      setTestMessage(error.message || 'AI 필터 테스트에 실패했습니다.');
    } finally {
      setTestLoading(false);
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
    <div style={styles.wrapper}>
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
          onChange={event => setForm(prev => ({ ...prev, prompt: event.target.value }))}
          placeholder={DEFAULT_MUSIC_FILTER_PROMPT}
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
          {MUSIC_FILTER_STRICTNESS_OPTIONS.map(item => {
            const active = form.strictness === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setForm(prev => ({ ...prev, strictness: item.id }))}
                style={{ ...styles.strictnessBtn, ...(active ? styles.strictnessActive : {}) }}
              >
                {item.label}
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

      <div style={styles.section}>
        <div style={styles.headerRow}>
          <div>
            <div style={styles.title}>AI 필터 테스트</div>
            <div style={styles.desc}>곡 URL을 입력하면 현재 화면의 매장 분위기 설명과 필터 강도로 수락/거절 판단을 미리 확인합니다.</div>
          </div>
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
          <button onClick={handleTest} disabled={!canTest} style={{ ...styles.testBtn, ...(!canTest ? styles.disabledBtn : {}) }}>
            {testLoading ? '테스트 중...' : '테스트하기'}
          </button>
        </div>

        {!form.prompt.trim() && (
          <div style={styles.warn}>테스트하려면 먼저 매장 분위기 설명을 입력해주세요.</div>
        )}
        {testMessage && <div style={styles.testNotice}>{testMessage}</div>}

        <TestResultCard result={testResult} />
      </div>
    </div>
  );
}

const styles = {
  wrapper: { display: 'grid', gap: 16 },
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
  strictnessBtn: { padding: '10px 0', textAlign: 'center', borderRadius: 10, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#777', outline: 'none' },
  strictnessActive: { borderColor: '#1a1a2e', background: '#1a1a2e', color: '#fff' },
  info: { marginTop: 14, padding: 12, borderRadius: 8, background: '#fff7e6', color: '#8a5a00', fontSize: 12, lineHeight: 1.45 },
  actions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 16, flexWrap: 'wrap' },
  okMsg: { marginRight: 'auto', fontSize: 12, color: '#4caf50' },
  errMsg: { marginRight: 'auto', fontSize: 12, color: '#e63946' },
  cancelBtn: { padding: '9px 14px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', color: '#777', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  saveBtn: { padding: '10px 24px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  disabledBtn: { opacity: 0.5, cursor: 'not-allowed' },
  badge: { flexShrink: 0, padding: '5px 9px', borderRadius: 999, background: '#eee', color: '#777', fontSize: 11, fontWeight: 700 },
  testInputRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 },
  input: { width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', outline: 'none', background: '#fff' },
  testBtn: { padding: '10px 16px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' },
  testNotice: { marginTop: 10, padding: 10, borderRadius: 8, background: '#fff1f1', color: '#b42318', fontSize: 12, lineHeight: 1.45 },
  testEmpty: { marginTop: 12, padding: 14, borderRadius: 10, border: '1px dashed #ddd', background: '#fff', color: '#999', fontSize: 12, lineHeight: 1.45 },
  testResult: { marginTop: 12, padding: 14, borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontSize: 13 },
  acceptResult: { borderColor: '#b7dfb9', background: '#f3fbf3' },
  rejectResult: { borderColor: '#f1c1c1', background: '#fff5f5' },
  resultTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  resultBadge: { fontSize: 12, fontWeight: 800, color: '#1a1a2e' },
  confidence: { fontSize: 12, color: '#777', fontWeight: 700 },
  reason: { color: '#333', lineHeight: 1.5 },
  trackMeta: { marginTop: 8, color: '#888', fontSize: 12, lineHeight: 1.4 },
  modelMeta: { marginTop: 4, color: '#aaa', fontSize: 11, lineHeight: 1.4 },
};
