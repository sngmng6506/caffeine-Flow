export default function SettingsStatus({ tone = 'info', children }) {
  if (!children) return null;

  const palette = {
    success: { color: '#087d5c', background: '#eefaf6', border: '#c9eee2', accent: 'var(--owner-success)' },
    error: { color: '#b7202d', background: '#fff7f7', border: '#f4c4c8', accent: 'var(--owner-danger)' },
    info: { color: 'var(--owner-text)', background: 'var(--owner-surface-subtle)', border: 'var(--owner-stroke)', accent: 'var(--owner-primary)' },
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
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 7, height: 7, marginTop: 5, flex: '0 0 7px', borderRadius: 999, background: palette.accent }}
      />
      {children}
    </div>
  );
}
