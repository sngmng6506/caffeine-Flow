import { useState } from 'react';
import { updateMe, updateNotice } from '../../api';
import { dashboardStyles as styles } from './dashboardStyles';
import SettingsStatus from './SettingsStatus';

export default function CafeProfileSettings({ cafe, onCafePatch }) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameLoading, setNameLoading] = useState(false);
  const [editingNotice, setEditingNotice] = useState(false);
  const [noticeInput, setNoticeInput] = useState('');
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [message, setMessage] = useState(null);

  async function handleNameSave() {
    const name = nameInput.trim();
    if (!name || name === cafe.name) {
      setEditingName(false);
      return;
    }

    setNameLoading(true);
    setMessage(null);
    try {
      const updated = await updateMe(name);
      onCafePatch({ name: updated.name });
      setEditingName(false);
      setMessage({ tone: 'success', text: '카페명을 저장했습니다.' });
    } catch (error) {
      console.error(error);
      setMessage({ tone: 'error', text: error.message || '카페명을 저장하지 못했습니다. 다시 시도해주세요.' });
    } finally {
      setNameLoading(false);
    }
  }

  async function saveNotice(value) {
    setNoticeLoading(true);
    setMessage(null);
    try {
      const { notice } = await updateNotice(value.trim() || null);
      onCafePatch({ notice });
      setEditingNotice(false);
      setMessage({ tone: 'success', text: notice ? '매장 공지를 저장했습니다.' : '매장 공지를 삭제했습니다.' });
    } catch (error) {
      console.error(error);
      setMessage({ tone: 'error', text: error.message || '매장 공지를 저장하지 못했습니다. 다시 시도해주세요.' });
    } finally {
      setNoticeLoading(false);
    }
  }

  return (
    <div style={profileStyles.section}>
      <div style={profileStyles.title}>매장 정보</div>
      <div style={profileStyles.desc}>손님 화면에 표시되는 카페명과 공지를 관리합니다.</div>
      <SettingsStatus tone={message?.tone}>{message?.text}</SettingsStatus>

      <div style={profileStyles.field}>
        <div style={profileStyles.label}>카페명</div>
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
          <div style={profileStyles.valueRow}>
            <span style={profileStyles.value}>{cafe.name}</span>
            <button
              onClick={() => {
                setMessage(null);
                setNameInput(cafe.name);
                setEditingName(true);
              }}
              style={styles.noticeEditBtn}
            >수정</button>
          </div>
        )}
      </div>

      <div style={profileStyles.field}>
        <div style={profileStyles.label}>매장 공지</div>
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
          <div style={profileStyles.valueRow}>
            <span style={cafe.notice ? profileStyles.value : profileStyles.emptyValue}>
              {cafe.notice || '등록된 공지가 없습니다.'}
            </span>
            <button
              onClick={() => {
                setMessage(null);
                setNoticeInput(cafe.notice || '');
                setEditingNotice(true);
              }}
              style={styles.noticeEditBtn}
            >{cafe.notice ? '수정' : '등록'}</button>
            {cafe.notice && (
              <button onClick={() => saveNotice('')} disabled={noticeLoading} style={styles.noticeDeleteBtn}>
                삭제
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const profileStyles = {
  section: { padding: '4px 0' },
  title: { fontSize: 14, fontWeight: 700, color: '#344054', marginBottom: 4 },
  desc: { fontSize: 12, color: '#667085', marginBottom: 14 },
  field: { padding: '14px 0', borderTop: '1px solid #e4e7ec' },
  label: { fontSize: 12, fontWeight: 700, color: '#667085', marginBottom: 8 },
  valueRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  value: { flex: '1 1 160px', minWidth: 0, fontSize: 13, color: '#344054', lineHeight: 1.5, wordBreak: 'break-word' },
  emptyValue: { flex: '1 1 160px', fontSize: 13, color: '#98a2b3' },
};
