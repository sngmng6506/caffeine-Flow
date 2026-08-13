export default function DashboardHeader({
  cafe,
  isAccepting,
  aiAutoAccept,
  onToggleAccepting,
  onToggleAiAutoAccept,
}) {
  return (
    <header className="owner-header">
      <div className="owner-header__identity">
        <h1 className="owner-header__name">{cafe.name}</h1>
        <div className="owner-header__status-list" aria-label="운영 상태">
          <span className={`owner-status ${isAccepting ? 'owner-status--success' : ''}`}>
            <span className="owner-status__dot" aria-hidden="true" />
            {isAccepting ? '신청 받는 중' : '신청 닫힘'}
          </span>
          <span className={`owner-status ${aiAutoAccept ? 'owner-status--primary' : ''}`}>
            <span className="owner-status__dot" aria-hidden="true" />
            AI 자동수락 {aiAutoAccept ? '켜짐' : '꺼짐'}
          </span>
        </div>
      </div>
      <div className="owner-header__actions" aria-label="운영 상태 변경">
        <button
          type="button"
          onClick={onToggleAccepting}
          aria-pressed={isAccepting}
          className="owner-btn owner-btn--secondary"
        >
          {isAccepting ? '신청 닫기' : '신청 열기'}
        </button>
        <button
          type="button"
          onClick={onToggleAiAutoAccept}
          aria-pressed={aiAutoAccept}
          className="owner-btn owner-btn--secondary"
        >
          AI 자동수락 {aiAutoAccept ? '끄기' : '켜기'}
        </button>
      </div>
    </header>
  );
}
