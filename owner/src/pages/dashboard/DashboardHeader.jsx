import { useState } from 'react';
import { updateMe, updateNotice } from '../../api';
import { dashboardStyles as styles } from './dashboardStyles';

export default function DashboardHeader({
  cafe,
  customerUrl,
  isAccepting,
  aiAutoAccept,
  onCafePatch,
  onToggleAccepting,
  onToggleAiAutoAccept,
  onLogout,
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameLoading, setNameLoading] = useState(false);
  const [editingNotice, setEditingNotice] = useState(false);
  const [noticeInput, setNoticeInput] = useState('');
  const [noticeLoading, setNoticeLoading] = useState(false);

  async function handleNameSave() {
    const name = nameInput.trim();
    if (!name || name === cafe.name) {
      setEditingName(false);
      return;
    }

    setNameLoading(true);
    try {
      const updated = await updateMe(name);
      onCafePatch({ name: updated.name });
      setEditingName(false);
    } catch (error) {
      console.error(error);
    } finally {
      setNameLoading(false);
    }
  }

  async function saveNotice(value) {
    setNoticeLoading(true);
    try {
      const { notice } = await updateNotice(value.trim() || null);
      onCafePatch({ notice });
      setEditingNotice(false);
    } catch (error) {
      console.error(error);
    } finally {
      setNoticeLoading(false);
    }
  }

  return (
    <>
      <div style={styles.header}>
        <div>
          {editingName ? (
            <div style={styles.nameEditRow}>
              <input
                value={nameInput}
                onChange={event => setNameInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') handleNameSave();
                  if (event.key === 'Escape') setEditingName(false);
                }}
                style={styles.nameInput}
                autoFocus
                maxLength={50}
              />
              <button onClick={handleNameSave} disabled={nameLoading} style={styles.nameSaveBtn}>
                {nameLoading ? '...' : '저장'}
              </button>
              <button onClick={() => setEditingName(false)} style={styles.nameCancelBtn}>취소</button>
            </div>
          ) : (
            <div style={styles.nameRow}>
              <div style={styles.cafeName}>{cafe.name}</div>
              <button
                onClick={() => {
                  setNameInput(cafe.name);
                  setEditingName(true);
                }}
                style={styles.nameEditBtn}
              >
                ✏️
              </button>
            </div>
          )}
          <div style={styles.urlRow}>
            <span style={styles.urlLabel}>손님 접속용 URL</span>
            <span style={styles.url}>{customerUrl}</span>
          </div>
        </div>
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
            AI 자동수락 {aiAutoAccept ? 'ON' : 'OFF'}
          </button>
          <button onClick={onLogout} style={styles.logoutBtn}>로그아웃</button>
        </div>
      </div>

      {editingNotice ? (
        <div style={styles.noticeEdit}>
          <textarea
            value={noticeInput}
            onChange={event => setNoticeInput(event.target.value)}
            placeholder="손님에게 표시될 공지사항을 입력하세요"
            style={styles.noticeInput}
            maxLength={200}
            autoFocus
            rows={2}
          />
          <div style={styles.noticeActions}>
            <span style={styles.noticeCount}>{noticeInput.length}/200</span>
            <button onClick={() => setEditingNotice(false)} style={styles.nameCancelBtn}>취소</button>
            <button onClick={() => saveNotice(noticeInput)} disabled={noticeLoading} style={styles.nameSaveBtn}>
              {noticeLoading ? '...' : '저장'}
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.noticeRow}>
          {cafe.notice
            ? <div style={styles.noticeBadge}>📢 {cafe.notice}</div>
            : <div style={styles.noticePlaceholder}>공지사항 없음</div>
          }
          <button
            onClick={() => {
              setNoticeInput(cafe.notice || '');
              setEditingNotice(true);
            }}
            style={styles.noticeEditBtn}
          >
            {cafe.notice ? '수정' : '+ 공지 등록'}
          </button>
          {cafe.notice && (
            <button onClick={() => saveNotice('')} disabled={noticeLoading} style={styles.noticeDeleteBtn}>
              삭제
            </button>
          )}
        </div>
      )}
    </>
  );
}
