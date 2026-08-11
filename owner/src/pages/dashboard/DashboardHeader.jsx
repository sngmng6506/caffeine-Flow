import { dashboardStyles as styles } from './dashboardStyles';

export default function DashboardHeader({
  cafe,
  isAccepting,
  aiAutoAccept,
  onToggleAccepting,
  onToggleAiAutoAccept,
}) {
  return (
    <div style={styles.header}>
      <div style={styles.cafeName}>{cafe.name}</div>
      <div style={styles.headerRight}>
        <button
          onClick={onToggleAccepting}
          style={{ ...styles.toggleBtn, background: isAccepting ? '#4caf50' : '#888' }}
        >
          {isAccepting ? '신청 받는 중' : '신청 닫힘'}
        </button>
        <button
          onClick={onToggleAiAutoAccept}
          style={{ ...styles.toggleBtn, background: aiAutoAccept ? '#ff9800' : '#9e9e9e', fontSize: 12 }}
        >
          AI 자동 재생 {aiAutoAccept ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
}
