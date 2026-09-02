import { REC_STATUS } from '../../constants/recommendationStatus';

const TABS = [
  ['queue', '신청 목록'],
  ['history', '이력'],
  ['settings', '설정'],
];

export default function DashboardTabs({ activeTab, recommendations, onChange }) {
  const pendingCount = recommendations.filter(r => r.status === REC_STATUS.PENDING).length;

  function handleKeyDown(event, currentValue) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = TABS.findIndex(([value]) => value === currentValue);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? TABS.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    const nextValue = TABS[nextIndex][0];
    onChange(nextValue);
    requestAnimationFrame(() => document.getElementById(`owner-tab-${nextValue}`)?.focus());
  }

  return (
    <div className="owner-tabs" role="tablist" aria-label="사장님 메뉴">
      {TABS.map(([value, label]) => (
        <button
          key={value}
          id={`owner-tab-${value}`}
          type="button"
          role="tab"
          aria-selected={activeTab === value}
          aria-controls={`owner-panel-${value}`}
          tabIndex={activeTab === value ? 0 : -1}
          onClick={() => onChange(value)}
          onKeyDown={event => handleKeyDown(event, value)}
          className={`owner-tab ${activeTab === value ? 'owner-tab--active' : ''}`}
        >
          {label}
          {value === 'queue' && pendingCount > 0 && (
            <span className="owner-count" aria-label={`새 신청 ${pendingCount}곡`}>{pendingCount}</span>
          )}
        </button>
      ))}
    </div>
  );
}
