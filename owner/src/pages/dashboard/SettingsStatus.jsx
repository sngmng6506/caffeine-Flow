import { useEffect, useState } from 'react';

export default function SettingsStatus({ tone = 'info', children }) {
  const [visible, setVisible] = useState(Boolean(children));

  useEffect(() => {
    if (!children) {
      setVisible(false);
      return undefined;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), tone === 'error' ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [children, tone]);

  if (!children || !visible) return null;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={`owner-settings-toast owner-settings-toast--${tone}`}
    >
      <span
        aria-hidden="true"
        className='owner-settings-toast__dot'
      />
      {children}
    </div>
  );
}
