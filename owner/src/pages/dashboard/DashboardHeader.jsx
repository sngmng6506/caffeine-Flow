export default function DashboardHeader({
  cafe,
  isAccepting,
  isAcceptingReady,
  aiAutoAccept,
  aiFilterReady,
  onToggleAccepting,
  onToggleAiAutoAccept,
  canCollapsePanel,
  onCollapsePanel,
}) {
  const acceptingLabel = isAcceptingReady
    ? (isAccepting ? '신청 받는 중' : '신청 닫힘')
    : '신청 확인 중';
  const aiFilterLabel = aiFilterReady
    ? (aiAutoAccept ? 'AI 필터 켜짐' : 'AI 필터 꺼짐')
    : 'AI 필터 확인 중';

  return (
    <header className="owner-header">
      <div className="owner-header__identity">
        <h1 className="owner-header__name">{cafe.name}</h1>
      </div>
      <div className="owner-header__actions" aria-label="운영 상태 변경">
        <button
          type="button"
          onClick={onToggleAccepting}
          aria-pressed={isAccepting}
          disabled={!isAcceptingReady}
          title={isAccepting ? '신청 닫기' : '신청 열기'}
          className={`owner-btn owner-operation-toggle ${isAcceptingReady && isAccepting ? 'owner-operation-toggle--success' : ''}`}
        >
          <span className="owner-operation-toggle__dot" aria-hidden="true" />
          {acceptingLabel}
        </button>
        <button
          type="button"
          onClick={onToggleAiAutoAccept}
          aria-pressed={aiAutoAccept}
          disabled={!aiFilterReady}
          title={aiAutoAccept ? 'AI 필터 끄기' : 'AI 필터 켜기'}
          className={`owner-btn owner-operation-toggle ${aiFilterReady && aiAutoAccept ? 'owner-operation-toggle--primary' : ''}`}
        >
          <span className="owner-operation-toggle__dot" aria-hidden="true" />
          {aiFilterLabel}
        </button>
        {canCollapsePanel && (
          <button
            type="button"
            onClick={onCollapsePanel}
            className="owner-btn owner-btn--secondary owner-header__collapse"
            aria-label="운영 패널 접기"
            title="운영 패널 접기"
          >
            <span aria-hidden="true">‹</span>
            <span>최소화</span>
          </button>
        )}
      </div>
    </header>
  );
}
