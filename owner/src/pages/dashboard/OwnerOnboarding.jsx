import { useState } from 'react';

const STORAGE_KEY = 'cf_owner_onboarding_v1';

function readDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

function storeDismissed(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, 'dismissed');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function openSettingsSection(id) {
  const section = document.getElementById(id);
  if (!section) return;
  section.open = true;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function OwnerOnboarding({
  hasDefaultBgm,
  allowedPlatformCount,
  aiAutoAccept,
  onOpenQueue,
}) {
  const [dismissed, setDismissed] = useState(readDismissed);

  function dismiss() {
    storeDismissed(true);
    setDismissed(true);
  }

  function reopen() {
    storeDismissed(false);
    setDismissed(false);
  }

  if (dismissed) {
    return (
      <button type="button" onClick={reopen} style={styles.reopenBtn}>
        처음 시작하기 다시 보기
      </button>
    );
  }

  const steps = [
    {
      title: '손님용 QR 준비',
      description: 'QR을 저장하거나 출력해 매장에 배치해요.',
      status: '확인 필요',
      onClick: () => openSettingsSection('owner-store-settings'),
      action: 'QR 열기',
    },
    {
      title: '기본 BGM 선택',
      description: '기본 BGM에는 재생목록 사용을 권장해요.',
      status: hasDefaultBgm ? '설정됨' : '설정 필요',
      complete: hasDefaultBgm,
      onClick: onOpenQueue,
      action: '신청 목록에서 설정',
    },
    {
      title: '신청 플랫폼 확인',
      description: `현재 ${allowedPlatformCount}개 플랫폼에서 신청곡을 받고 있어요.`,
      status: allowedPlatformCount > 0 ? '확인됨' : '설정 필요',
      complete: allowedPlatformCount > 0,
      onClick: () => openSettingsSection('owner-operation-settings'),
      action: '플랫폼 확인',
    },
    {
      title: 'AI 자동수락',
      description: '선택 사항이에요. 매장 분위기 설명을 기준으로 새 신청을 확인해요.',
      status: aiAutoAccept ? '사용 중' : '선택 사항',
      complete: aiAutoAccept,
      onClick: () => openSettingsSection('owner-operation-settings'),
      action: 'AI 설정 보기',
    },
  ];

  return (
    <section aria-labelledby="owner-onboarding-title" style={styles.wrap}>
      <div style={styles.header}>
        <div>
          <div id="owner-onboarding-title" style={styles.title}>처음 시작하기</div>
          <div style={styles.desc}>필요한 항목만 확인한 뒤 바로 운영을 시작할 수 있어요.</div>
        </div>
        <button type="button" onClick={dismiss} style={styles.dismissBtn}>안내 닫기</button>
      </div>

      <div style={styles.steps}>
        {steps.map((step, index) => (
          <div key={step.title} style={styles.step}>
            <div style={{ ...styles.stepNumber, ...(step.complete ? styles.stepNumberComplete : {}) }}>
              {step.complete ? '✓' : index + 1}
            </div>
            <div style={styles.stepInfo}>
              <div style={styles.stepTitleRow}>
                <span style={styles.stepTitle}>{step.title}</span>
                <span style={{ ...styles.status, ...(step.complete ? styles.statusComplete : {}) }}>{step.status}</span>
              </div>
              <div style={styles.stepDesc}>{step.description}</div>
            </div>
            <button type="button" onClick={step.onClick} style={styles.actionBtn}>{step.action}</button>
          </div>
        ))}
      </div>
    </section>
  );
}

const styles = {
  wrap: { padding: 16, borderRadius: 12, border: '1px solid var(--owner-stroke)', background: 'var(--owner-surface)' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  title: { fontSize: 15, fontWeight: 750, color: 'var(--owner-text-strong)' },
  desc: { marginTop: 4, fontSize: 12, color: 'var(--owner-text-muted)', lineHeight: 1.45 },
  dismissBtn: { flexShrink: 0, minHeight: 40, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--owner-stroke)', background: '#fff', color: 'var(--owner-text-muted)', cursor: 'pointer', fontSize: 12 },
  steps: { display: 'flex', flexDirection: 'column' },
  step: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '12px 0', borderTop: '1px solid var(--owner-stroke)' },
  stepNumber: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, flexShrink: 0, borderRadius: 999, background: '#e9eef5', color: '#667085', fontSize: 11, fontWeight: 800 },
  stepNumberComplete: { background: '#e6f7f1', color: '#087d5c' },
  stepInfo: { flex: 1, minWidth: 0 },
  stepTitleRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  stepTitle: { fontSize: 13, fontWeight: 700, color: 'var(--owner-text)' },
  stepDesc: { marginTop: 3, color: 'var(--owner-text-muted)', fontSize: 12, lineHeight: 1.4 },
  status: { padding: '2px 6px', borderRadius: 999, background: 'var(--owner-surface-subtle)', color: 'var(--owner-text-muted)', fontSize: 11, fontWeight: 700 },
  statusComplete: { background: '#e6f7f1', color: '#087d5c' },
  actionBtn: { flexShrink: 0, minHeight: 40, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--owner-stroke)', background: '#fff', color: 'var(--owner-text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  reopenBtn: { alignSelf: 'flex-start', minHeight: 40, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--owner-stroke)', background: '#fff', color: 'var(--owner-text-muted)', cursor: 'pointer', fontSize: 12 },
};
