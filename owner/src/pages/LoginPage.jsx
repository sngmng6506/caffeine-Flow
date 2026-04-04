import { useState } from 'react';
import { login, register } from '../api';

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ name: '', slug: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      let res;
      if (mode === 'login') {
        res = await login(form.email, form.password);
      } else {
        res = await register(form.name, form.slug, form.email, form.password);
      }
      localStorage.setItem('token', res.token);
      localStorage.setItem('cafe', JSON.stringify(res.cafe));
      onLogin(res.cafe);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <h1 style={styles.title}>☕ Caffeine Flow</h1>
      <div style={styles.tabs}>
        <button onClick={() => setMode('login')}    style={{ ...styles.tab, ...(mode === 'login'    ? styles.tabActive : {}) }}>로그인</button>
        <button onClick={() => setMode('register')} style={{ ...styles.tab, ...(mode === 'register' ? styles.tabActive : {}) }}>회원가입</button>
      </div>
      <form onSubmit={handleSubmit} style={styles.form}>
        {mode === 'register' && (
          <>
            <input placeholder="카페 이름" value={form.name} onChange={e => set('name', e.target.value)} style={styles.input} required />
            <input placeholder="slug (영소문자, 숫자, 하이픈만)" value={form.slug} onChange={e => set('slug', e.target.value)} style={styles.input} required />
          </>
        )}
        <input placeholder="이메일" type="email" value={form.email} onChange={e => set('email', e.target.value)} style={styles.input} required />
        <input placeholder="비밀번호" type="password" value={form.password} onChange={e => set('password', e.target.value)} style={styles.input} required />
        {error && <div style={styles.error}>{error}</div>}
        <button type="submit" disabled={loading} style={styles.btn}>
          {loading ? '처리 중...' : mode === 'login' ? '로그인' : '가입하기'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  wrap:      { maxWidth: 360, margin: '80px auto', padding: '32px', fontFamily: 'sans-serif', boxShadow: '0 2px 16px rgba(0,0,0,0.1)', borderRadius: 16 },
  title:     { textAlign: 'center', marginBottom: 24, fontSize: 24 },
  tabs:      { display: 'flex', marginBottom: 20, borderBottom: '2px solid #eee' },
  tab:       { flex: 1, padding: '8px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#888' },
  tabActive: { color: '#1a1a2e', fontWeight: 700, borderBottom: '2px solid #1a1a2e', marginBottom: -2 },
  form:      { display: 'flex', flexDirection: 'column', gap: 12 },
  input:     { padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, outline: 'none' },
  btn:       { padding: '12px', borderRadius: 8, background: '#1a1a2e', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 15 },
  error:     { fontSize: 13, color: '#e63946' },
};
