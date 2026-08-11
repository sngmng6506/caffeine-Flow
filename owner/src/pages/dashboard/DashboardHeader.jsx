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
          aria-pressed={isAccepting}
          style={{ ...styles.toggleBtn, ...(isAccepting ? styles.acceptingOn : styles.toggleOff) }}
        >
          {isAccepting ? '신청 받는 중' : '신청 닫힘'}
        </button>
        <button
          onClick={onToggleAiAutoAccept}
          aria-pressed={aiAutoAccept}
          style={{ ...styles.toggleBtn, ...(aiAutoAccept ? styles.aiOn : styles.toggleOff) }}
        >
          AI 자동 재생 {aiAutoAccept ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
}
