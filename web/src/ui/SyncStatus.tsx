import { useState } from 'react';
import { signIn } from '../sync/auth';
import { syncNow, useSyncStatus } from '../sync/sync';
import { t, useLanguage } from '../i18n';

function when(at: number, lang: string): string {
  const d = new Date(at);
  const sameDay = d.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(lang, sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** Small sync status line: synced <time> / syncing… / offline / sign in to sync (button) / sync error. */
export function SyncStatus({ style }: { style?: React.CSSProperties }) {
  const lang = useLanguage();
  const { status, at, running } = useSyncStatus();
  const [signingIn, setSigningIn] = useState(false);
  const base: React.CSSProperties = { fontSize: 12, color: '#C6D8E6', ...style };

  if (running) return <div role="status" style={base}>{t('sync.syncing')}</div>;
  if (status === 'authNeeded') {
    return (
      <button type="button" disabled={signingIn} onClick={async () => {
        setSigningIn(true);
        try { await signIn(); await syncNow(); } catch (e) { console.warn('[sync] sign-in failed', e); } finally { setSigningIn(false); }
      }} style={{ ...base, minHeight: 44, border: 0, background: 'transparent', color: '#8FD8F2', fontWeight: 600, padding: 0, textAlign: 'left' }}>
        {t('sync.signIn')}
      </button>
    );
  }
  if (status === 'ok' && at) return <div role="status" style={base}>{t('sync.synced', { time: when(at, lang) })}</div>;
  if (status === 'offline') return <div role="status" style={base}>{t('sync.offline')}</div>;
  if (status === 'error') return <div role="status" style={{ ...base, color: '#FFB4B4' }}>{t('sync.error')}</div>;
  return null;
}
