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
      <button onClick={reopen} style={styles.reopenBtn}>
        처음 시작하기 다시 보기
      </button>
    );
  }

  const steps = [
    {
      title: '손님용 QR 준비',
      description: 'QR을 저장하거나 출력해 매장에 배치합니다.',
      status: '확인 필요',
      onClick: () => openSettingsSection('owner-store-settings'),
      action: 'QR 열기',
    },
    {
      title: '기본 BGM 선택',
      description: '신청곡이 없을 때 재생할 음악이나 플레이리스트를 지정합니다.',
      status: hasDefaultBgm ? '설정됨' : '설정 필요',
      complete: hasDefaultBgm,
      onClick: onOpenQueue,
      action: '신청 목록에서 설정',
    },
    {
      title: '신청 플랫폼 확인',
      description: `현재 ${allowedPlatformCount}개 플랫폼에서 신청을 받고 있습니다.`,
      status: allowedPlatformCount > 0 ? '확인됨' : '설정 필요',
      complete: allowedPlatformCount > 0,
      onClick: () => openSettingsSection('owner-operation-settings'),
      action: '플랫폼 확인',
    },
    {
      title: 'AI 자동 재생',
      description: '선택 사항입니다. 매장 분위기 설명을 기준으로 신청곡을 자동 심사합니다.',
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
          <div style={styles.desc}>필요한 항목만 확인한 뒤 바로 운영을 시작할 수 있습니다.</div>
        </div>
        <button onClick={dismiss} style={styles.dismissBtn}>안내 닫기</button>
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
            <button onClick={step.onClick} style={styles.actionBtn}>{step.action}</button>
          </div>
        ))}
      </div>
    </section>
  );
}

const styles = {
  wrap: { padding: 16, borderRadius: 10, border: '1px solid #e4e7ec', background: '#f9fafb' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  title: { fontSize: 15, fontWeight: 800, color: '#1f2937' },
  desc: { marginTop: 4, fontSize: 12, color: '#667085', lineHeight: 1.45 },
  dismissBtn: { flexShrink: 0, minHeight: 34, padding: '6px 10px', borderRadius: 7, border: '1px solid #d0d5dd', background: '#fff', color: '#667085', cursor: 'pointer', fontSize: 11 },
  steps: { display: 'flex', flexDirection: 'column' },
  step: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '11px 0', borderTop: '1px solid #e4e7ec' },
  stepNumber: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, flexShrink: 0, borderRadius: 999, background: '#e9eef5', color: '#667085', fontSize: 11, fontWeight: 800 },
  stepNumberComplete: { background: '#dcf5e8', color: '#1f7a4d' },
  stepInfo: { flex: 1, minWidth: 0 },
  stepTitleRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  stepTitle: { fontSize: 13, fontWeight: 700, color: '#344054' },
  stepDesc: { marginTop: 3, color: '#667085', fontSize: 11, lineHeight: 1.4 },
  status: { padding: '2px 6px', borderRadius: 999, background: '#eef1f5', color: '#667085', fontSize: 10, fontWeight: 700 },
  statusComplete: { background: '#dcf5e8', color: '#1f7a4d' },
  actionBtn: { flexShrink: 0, minHeight: 34, padding: '6px 10px', borderRadius: 7, border: '1px solid #d0d5dd', background: '#fff', color: '#344054', cursor: 'pointer', fontSize: 11, fontWeight: 600 },
  reopenBtn: { alignSelf: 'flex-start', minHeight: 36, padding: '7px 11px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#fff', color: '#667085', cursor: 'pointer', fontSize: 12 },
};
