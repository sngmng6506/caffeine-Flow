import { useState } from 'react';
import { updateMe } from '../../api';
import { dashboardStyles as styles } from './dashboardStyles';
import SettingsStatus from './SettingsStatus';

export default function CafeProfileSettings({ cafe, onCafePatch }) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameLoading, setNameLoading] = useState(false);
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
      setMessage({ tone: 'success', text: '매장명을 적용했어요.' });
    } catch (error) {
      console.error(error);
      setMessage({ tone: 'error', text: error.message || '매장명을 적용하지 못했어요. 다시 시도해 주세요.' });
    } finally {
      setNameLoading(false);
    }
  }

  return (
    <div style={profileStyles.section}>
      <SettingsStatus tone={message?.tone}>{message?.text}</SettingsStatus>

      <div style={profileStyles.field}>
        <div style={profileStyles.label}>매장명</div>
        {editingName ? (
          <div style={styles.nameEdit}>
            <input
              value={nameInput}
              aria-label="매장명"
              onChange={event => setNameInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') handleNameSave();
                if (event.key === 'Escape') setEditingName(false);
              }}
              style={styles.nameInput}
              autoFocus
              maxLength={50}
            />
            <div style={styles.actions}>
              <button type="button" onClick={() => setEditingName(false)} style={styles.nameCancelBtn}>취소</button>
              <button type="button" onClick={handleNameSave} disabled={nameLoading} style={styles.nameSaveBtn}>
                {nameLoading ? '적용 중…' : '적용'}
              </button>
            </div>
          </div>
        ) : (
          <div style={profileStyles.valueRow}>
            <span style={profileStyles.value}>{cafe.name}</span>
            <button
              type="button"
              onClick={() => {
                setMessage(null);
                setNameInput(cafe.name);
                setEditingName(true);
              }}
              style={styles.editBtn}
            >수정</button>
          </div>
        )}
      </div>
    </div>
  );
}

const profileStyles = {
  section: { padding: '4px 0' },
  field: { padding: '14px 0', borderTop: '1px solid var(--owner-stroke)' },
  label: { fontSize: 12, fontWeight: 700, color: 'var(--owner-text-muted)', marginBottom: 8 },
  valueRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  value: { flex: '1 1 160px', minWidth: 0, fontSize: 13, color: 'var(--owner-text)', lineHeight: 1.5, wordBreak: 'break-word' },
};
