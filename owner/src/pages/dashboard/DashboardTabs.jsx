import { REC_STATUS } from '../../constants/recommendationStatus';
import { dashboardStyles as styles } from './dashboardStyles';

const TABS = [
  ['queue', '신청 목록'],
  ['history', '이력'],
  ['stats', '통계'],
  ['qr', 'QR 코드'],
  ['settings', '설정'],
  ['contact', '문의'],
  ['shortcuts', '바로가기'],
];

export default function DashboardTabs({ activeTab, recommendations, onChange }) {
  const pendingCount = recommendations.filter(r => r.status === REC_STATUS.PENDING).length;

  return (
    <div style={styles.tabs}>
      {TABS.map(([value, label]) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          style={{ ...styles.tab, ...(activeTab === value ? styles.tabActive : {}) }}
        >
          {label}
          {value === 'queue' && pendingCount > 0 && <span style={styles.badge}>{pendingCount}</span>}
        </button>
      ))}
    </div>
  );
}
