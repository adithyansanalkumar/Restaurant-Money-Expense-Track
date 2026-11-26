import { useSyncStatus } from '../sync/sync';
import { t, useLanguage } from '../i18n';
import { useSignInLater } from './useSignIn';
import { SignInPrompts } from './ConsentNotice';

function when(at: number, lang: string): string {
  const d = new Date(at);
  const sameDay = d.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(lang, sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** Small sync status line: synced <time> / syncing… / offline / sign in to sync (button) / sync error. */
export function SyncStatus({ style }: { style?: React.CSSProperties }) {
  const lang = useLanguage();
  const { status, at, running } = useSyncStatus();
  // signInLater: syncs the chosen ledger, or adopts this account's one first when none is chosen
  const s = useSignInLater();
  const go = async (viaReset = false) => {
    try { await (viaReset ? s.resetAndRetry() : s.run()); } catch (e) { console.warn('[sync] sign-in failed', e); }
  };
  const base: React.CSSProperties = { fontSize: 12, color: '#C6D8E6', ...style };

  const prompts = <SignInPrompts s={s} onContinue={() => void go()} onReset={() => void go(true)} />;
  if (s.consent || s.switchTo) return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{prompts}</div>;
  if (running) return <div role="status" style={base}>{t('sync.syncing')}</div>;
  if (status === 'authNeeded') {
    return (
      <button type="button" disabled={s.busy} onClick={() => void go()}
        style={{ ...base, minHeight: 44, border: 0, background: 'transparent', color: '#8FD8F2', fontWeight: 600, padding: 0, textAlign: 'left' }}>
        {t('sync.signIn')}
      </button>
    );
  }
  if (status === 'ok' && at) return <div role="status" style={base}>{t('sync.synced', { time: when(at, lang) })}</div>;
  if (status === 'offline') return <div role="status" style={base}>{t('sync.offline')}</div>;
  if (status === 'error') return <div role="status" style={{ ...base, color: '#FFB4B4' }}>{t('sync.error')}</div>;
  return null;
}
