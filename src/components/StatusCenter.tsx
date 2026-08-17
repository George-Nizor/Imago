import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { Icon } from './Icon';

export function StatusCenter() {
  const notice = useEditorStore((state) => state.notice);

  useEffect(() => {
    if (!notice || notice.tone === 'error') return;
    const id = window.setTimeout(() => useEditorStore.getState().setNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  if (!notice) return null;
  const isError = notice.tone === 'error';
  return (
    <aside
      className={`status-center ${notice.tone}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span className="status-center-icon">
        <Icon name={isError ? 'warning' : notice.tone === 'success' ? 'check' : 'sparkle'} />
      </span>
      <span className="status-center-copy">
        <strong>{notice.message}</strong>
        {(notice.detail || notice.code) && (
          <small>
            {notice.detail}
            {notice.code && <code>{notice.code}</code>}
          </small>
        )}
      </span>
      <button
        type="button"
        className="status-center-close"
        aria-label="Dismiss notification"
        onClick={() => useEditorStore.getState().setNotice(null)}
      >
        <Icon name="close" />
      </button>
    </aside>
  );
}
