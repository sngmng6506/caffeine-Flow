import { Music2 } from 'lucide-react';

export default function StatePanel({ icon: Icon = Music2, title, description, loading = false }) {
  return (
    <div className='empty-state' role={loading ? 'status' : undefined}>
      <span className='empty-state__icon' aria-hidden='true'>
        <Icon size={24} className={loading ? 'spin' : ''} />
      </span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}
