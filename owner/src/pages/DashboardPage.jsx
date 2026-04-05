import { useEffect, useState } from 'react';
import { getRecommendations, setStatus, updateMe, updateNotice } from '../api';
import { getSocket, disconnectSocket } from '../socket';
import RecommendCard from './RecommendCard';
import StatsPanel from './StatsPanel';

export default function DashboardPage({ cafe: initialCafe, onLogout }) {
  const [cafe, setCafe]         = useState(initialCafe);
  const [recs, setRecs]         = useState([]);
  const [isAccepting, setIsAccepting] = useState(true);
  const [tab, setTab]           = useState('queue');
  const [loading, setLoading]   = useState(true);
  const [editingName, setEditingName]       = useState(false);
  const [nameInput, setNameInput]           = useState('');
  const [nameLoading, setNameLoading]       = useState(false);
  const [editingNotice, setEditingNotice]   = useState(false);
  const [noticeInput, setNoticeInput]       = useState('');
  const [noticeLoading, setNoticeLoading]   = useState(false);

  const queue   = recs.filter(r => r.status === 'pending' || r.status === 'accepted' || r.status === 'playing');
  const history = recs.filter(r => r.status === 'played' || r.status === 'skipped' || r.status === 'rejected');

  const customerUrl = `${window.location.origin}/${cafe.slug}`;

  async function handleNoticeSave() {
    setNoticeLoading(true);
    try {
      const { notice } = await updateNotice(noticeInput.trim() || null);
      setCafe(prev => ({ ...prev, notice }));
      setEditingNotice(false);
    } catch (e) {
      console.error(e);
    } finally {
      setNoticeLoading(false);
    }
  }

  async function handleNameSave() {
    if (!nameInput.trim() || nameInput === cafe.name) { setEditingName(false); return; }
    setNameLoading(true);
    try {
      const updated = await updateMe(nameInput.trim());
      setCafe(prev => ({ ...prev, name: updated.name }));
      localStorage.setItem('cafe', JSON.stringify({ ...cafe, name: updated.name }));
      setEditingName(false);
    } catch (e) {
      console.error(e);
    } finally {
      setNameLoading(false);
    }
  }

  useEffect(() => {
    getRecommendations(cafe.slug)
      .then(({ recommendations, is_accepting }) => {
        setRecs(recommendations);
        setIsAccepting(is_accepting);
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    const socket = getSocket(cafe.slug);
    socket.on('recommendations_update', ({ action, rec, id }) => {
      if (action === 'add')                  setRecs(prev => [rec, ...prev]);
      if (action === 'update' || action === 'vote') setRecs(prev => prev.map(r => r.id === rec.id ? rec : r));
      if (action === 'delete')               setRecs(prev => prev.filter(r => r.id !== id));
    });
    socket.on('system_toggled', ({ is_accepting }) => setIsAccepting(is_accepting));

    return () => disconnectSocket();
  }, [cafe.slug]);

  async function toggleAccepting() {
    const next = !isAccepting;
    setIsAccepting(next);
    try { await setStatus(next); }
    catch { setIsAccepting(!next); }
  }

  function handleUpdate(updated) { setRecs(prev => prev.map(r => r.id === updated.id ? updated : r)); }
  function handleDelete(id)      { setRecs(prev => prev.filter(r => r.id !== id)); }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          {editingName ? (
            <div style={styles.nameEditRow}>
              <input
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') setEditingName(false); }}
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
                onClick={() => { setNameInput(cafe.name); setEditingName(true); }}
                style={styles.nameEditBtn}
              >✏️</button>
            </div>
          )}
          <div style={styles.urlRow}>
            <span style={styles.urlLabel}>손님 접속용 URL</span>
            <span style={styles.url}>{customerUrl}</span>
          </div>
        </div>
        <div style={styles.headerRight}>
          <button onClick={toggleAccepting} style={{ ...styles.toggleBtn, background: isAccepting ? '#4caf50' : '#888' }}>
            {isAccepting ? '신청 받는 중' : '신청 닫힘'}
          </button>
          <button onClick={onLogout} style={styles.logoutBtn}>로그아웃</button>
        </div>
      </div>

      {/* 공지사항 */}
      {editingNotice ? (
        <div style={styles.noticeEdit}>
          <textarea
            value={noticeInput}
            onChange={e => setNoticeInput(e.target.value)}
            placeholder="손님에게 표시될 공지사항을 입력하세요"
            style={styles.noticeInput}
            maxLength={200}
            autoFocus
            rows={2}
          />
          <div style={styles.noticeActions}>
            <span style={styles.noticeCount}>{noticeInput.length}/200</span>
            <button onClick={() => setEditingNotice(false)} style={styles.nameCancelBtn}>취소</button>
            <button onClick={handleNoticeSave} disabled={noticeLoading} style={styles.nameSaveBtn}>
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
            onClick={() => { setNoticeInput(cafe.notice || ''); setEditingNotice(true); }}
            style={styles.noticeEditBtn}
          >
            {cafe.notice ? '수정' : '+ 공지 등록'}
          </button>
          {cafe.notice && (
            <button onClick={() => { setNoticeInput(''); handleNoticeSave(); }} style={styles.noticeDeleteBtn}>삭제</button>
          )}
        </div>
      )}

      <div style={styles.tabs}>
        <button onClick={() => setTab('queue')} style={{ ...styles.tab, ...(tab === 'queue' ? styles.tabActive : {}) }}>
          추천 목록 {queue.length > 0 && <span style={styles.badge}>{queue.length}</span>}
        </button>
        <button onClick={() => setTab('stats')}   style={{ ...styles.tab, ...(tab === 'stats'   ? styles.tabActive : {}) }}>통계</button>
        <button onClick={() => setTab('qr')}      style={{ ...styles.tab, ...(tab === 'qr'      ? styles.tabActive : {}) }}>QR 코드</button>
        <button onClick={() => setTab('contact')} style={{ ...styles.tab, ...(tab === 'contact' ? styles.tabActive : {}) }}>문의</button>
      </div>

      {tab === 'queue' && (
        <div>
          {loading && <div style={styles.empty}>불러오는 중...</div>}
          {!loading && queue.length === 0 && <div style={styles.empty}>대기 중인 추천곡이 없습니다.</div>}
          {queue.map(r => (
            <RecommendCard key={r.id} slug={cafe.slug} rec={r} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
          {history.length > 0 && (
            <>
              <h3 style={styles.sectionTitle}>오늘 이력</h3>
              {history.map(r => (
                <RecommendCard key={r.id} slug={cafe.slug} rec={r} onUpdate={handleUpdate} onDelete={handleDelete} />
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'stats'   && <StatsPanel />}
      {tab === 'qr'      && <QRTab url={customerUrl} cafeName={cafe.name} />}
      {tab === 'contact' && <ContactTab provider={cafe.provider} />}
    </div>
  );
}

function QRTab({ url, cafeName }) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=240x240&margin=10`;

  function handleDownload() {
    const a = document.createElement('a');
    a.href = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=600x600&margin=20&format=png`;
    a.download = `${cafeName}-qr.png`;
    a.target = '_blank';
    a.click();
  }

  return (
    <div style={qrStyles.wrap}>
      {/* <div style={qrStyles.urlBox}>{url}</div> */}
      <div style={qrStyles.imgWrap}>
        <img src={qrUrl} alt="QR 코드" style={qrStyles.img} />
      </div>
      <div style={qrStyles.hint}>손님이 QR코드를 스캔하면 음악 신청 페이지로 이동합니다.</div>
      <div style={qrStyles.hint}>프린트해서 카페 내에서 사용해주세요.</div>
      <button onClick={handleDownload} style={qrStyles.btn}>이미지 다운로드</button>
    </div>
  );
}

function ContactTab({ provider }) {
  const subject = 'Caffeine Flow 문의';
  const to      = 'sngmng6506@gmail.com';
  const mailUrl = provider === 'naver'
    ? `https://mail.naver.com/write?to=${to}&subject=${encodeURIComponent(subject)}`
    : `https://mail.google.com/mail/?view=cm&to=${to}&su=${encodeURIComponent(subject)}`;

  return (
    <div style={contactStyles.wrap}>
      <h3 style={contactStyles.title}>개발자 문의</h3>
      <div style={contactStyles.box}>
        <p style={contactStyles.desc}>
          시스템 오류, 기능 요청, 기타 문의사항이 있으시면<br />아래 버튼을 눌러 메일을 보내주세요.
        </p>
        <a href={mailUrl} target="_blank" rel="noreferrer" style={contactStyles.btn}>
          메일 보내기
        </a>
      </div>
    </div>
  );
}

const styles = {
  page:        { maxWidth: 600, margin: '0 auto', padding: '16px', fontFamily: 'sans-serif' },
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #eee' },
  nameRow:       { display: 'flex', alignItems: 'center', gap: 6 },
  cafeName:      { fontWeight: 700, fontSize: 18 },
  nameEditBtn:   { fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 },
  nameEditRow:   { display: 'flex', alignItems: 'center', gap: 6 },
  nameInput:     { fontSize: 16, fontWeight: 700, padding: '2px 6px', borderRadius: 6, border: '1px solid #ddd', outline: 'none', width: 160 },
  nameSaveBtn:   { fontSize: 12, padding: '3px 10px', borderRadius: 6, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer' },
  nameCancelBtn: { fontSize: 12, padding: '3px 10px', borderRadius: 6, background: '#fff', border: '1px solid #ddd', cursor: 'pointer' },
  urlRow:      { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 },
  urlLabel:    { fontSize: 11, color: '#aaa' },
  url:         { fontSize: 12, color: '#888' },
  headerRight: { display: 'flex', gap: 8, alignItems: 'center' },
  toggleBtn:   { padding: '6px 12px', borderRadius: 20, border: 'none', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  logoutBtn:   { padding: '6px 12px', borderRadius: 20, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13 },
  noticeRow:         { display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', padding: '8px 12px', background: '#f8f8f8', borderRadius: 8 },
  noticeBadge:       { flex: 1, fontSize: 13, color: '#333' },
  noticePlaceholder: { flex: 1, fontSize: 13, color: '#bbb' },
  noticeEditBtn:     { fontSize: 12, padding: '3px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' },
  noticeDeleteBtn:   { fontSize: 12, padding: '3px 10px', borderRadius: 6, border: '1px solid #fcc', background: '#fff', color: '#e63946', cursor: 'pointer' },
  noticeEdit:        { margin: '12px 0', display: 'flex', flexDirection: 'column', gap: 6 },
  noticeInput:       { fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', outline: 'none', resize: 'none', fontFamily: 'sans-serif' },
  noticeActions:     { display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' },
  noticeCount:       { fontSize: 12, color: '#aaa', marginRight: 'auto' },
  tabs:        { display: 'flex', marginBottom: 16, borderBottom: '2px solid #eee' },
  tab:         { padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#888', display: 'flex', alignItems: 'center', gap: 6 },
  tabActive:   { color: '#1a1a2e', fontWeight: 700, borderBottom: '2px solid #1a1a2e', marginBottom: -2 },
  badge:       { background: '#e63946', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11 },
  sectionTitle:{ fontSize: 14, color: '#888', margin: '20px 0 8px', fontWeight: 600 },
  empty:       { textAlign: 'center', color: '#aaa', padding: '40px 0' },
};

const qrStyles = {
  wrap:    { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingTop: 16 },
  urlBox:  { fontSize: 12, color: '#888', background: '#f8f8f8', borderRadius: 8, padding: '8px 16px', wordBreak: 'break-all', textAlign: 'center' },
  imgWrap: { background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 16, display: 'inline-block' },
  img:     { display: 'block', width: 240, height: 240 },
  hint:    { fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 1.7 },
  btn:     { padding: '10px 28px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
};

const contactStyles = {
  wrap:  { paddingTop: 16 },
  title: { fontSize: 15, fontWeight: 700, marginBottom: 16 },
  box:   { background: '#f8f8f8', borderRadius: 12, padding: 24 },
  desc:  { fontSize: 14, color: '#666', lineHeight: 1.8, marginBottom: 20 },
  btn:   { display: 'block', background: '#1a1a2e', color: '#fff', textAlign: 'center', borderRadius: 8, padding: '13px', fontSize: 14, fontWeight: 700, textDecoration: 'none' },
};
