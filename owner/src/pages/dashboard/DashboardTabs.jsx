import { REC_STATUS } from '../../constants/recommendationStatus';

const TABS = [
  ['queue', '신청 목록'],
  ['history', '이력'],
  ['settings', '설정'],
];

export default function DashboardTabs({ activeTab, recommendations, onChange }) {
  const pendingCount = recommendations.filter(r => r.status === REC_STATUS.PENDING).length;

  return (
    <div className="owner-tabs" role="tablist" aria-label="사장님 메뉴">
      {TABS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={activeTab === value}
          onClick={() => onChange(value)}
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
