export default function SettingsStatus({ tone = 'info', children }) {
  if (!children) return null;

  const palette = {
    success: { color: '#1f7a4d', background: '#edf8f2', border: '#ccebd9' },
    error: { color: '#b42318', background: '#fff1f0', border: '#f3c7c2' },
    info: { color: '#475467', background: '#f7f8fa', border: '#e4e7ec' },
  }[tone] || {};

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      style={{
        marginTop: 12,
        padding: '9px 11px',
        borderRadius: 8,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      {children}
    </div>
  );
}
