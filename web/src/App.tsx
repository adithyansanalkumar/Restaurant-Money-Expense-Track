import { useCallback, useEffect, useRef, useState } from 'react';
import { Glass } from './ui/Glass';
import { TabBar } from './ui/TabBar';
import { useRoute, type Route } from './ui/router';
import { Setup } from './screens/Setup';
import { Home } from './screens/Home';
import { History } from './screens/History';
import { Reports } from './screens/Reports';
import { getEditing, setEditing } from './ui/editing';
import { Bills } from './screens/Bills';
import { Owe } from './screens/Owe';
import { AddEntry } from './screens/AddEntry';
import { t, useLanguage } from './i18n';
import { useSettings } from './settings/store';
import { Lock } from './screens/Lock';
import { Welcome } from './screens/Welcome';
import { Join } from './screens/Join';
import { Settings } from './screens/Settings';
import { backupPendingPhotos } from './photos/backup';
import { useSyncStatus } from './sync/sync';
import { hasPin, onPinChange, shouldLock } from './lock/lock';

export function App() {
  useLanguage();
  const [route, rawGo] = useRoute();
  const go = useCallback((r: Route) => { if (r !== 'add') setEditing(null); rawGo(r); }, [rawGo]);
  const { loaded, shared } = useSettings();
  const { at: syncedAt } = useSyncStatus();
  const needsSetup = loaded && !shared;
  // 'checking' until we know whether a PIN exists; while 'locked' nothing else renders.
  // 'error' = the lock could not be read: fail closed, never open.
  const [lockState, setLockState] = useState<'checking' | 'locked' | 'open' | 'error'>('checking');
  const hiddenAt = useRef<number | null>(null);
  // Synchronous cache of "a PIN is set", so re-locking needs no await. null = unknown.
  const pinSet = useRef<boolean | null>(null);
  // First run: Welcome (sign in / not now) comes before Setup.
  const [firstRun, setFirstRun] = useState<'welcome' | 'setup'>('welcome');

  useEffect(() => {
    let live = true;
    const check = async () => {
      let p: boolean | undefined;
      for (let i = 0; i < 2 && p === undefined; i++) {
        try { p = await hasPin(); } catch { /* retry once */ }
      }
      if (!live) return;
      if (p === undefined) { setLockState('error'); return; }
      pinSet.current = p;
      setLockState(p ? 'locked' : 'open');
    };
    void check();
    const off = onPinChange((has) => { pinSet.current = has; });
    return () => { live = false; off(); };
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return; }
      const at = hiddenAt.current;
      hiddenAt.current = null;
      if (at !== null && pinSet.current !== false && shouldLock(at, Date.now())) {
        setLockState((s) => (s === 'checking' ? s : pinSet.current === null ? 'error' : 'locked'));
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (needsSetup && route !== 'setup' && route !== 'join') go('setup');
    else if (!needsSetup && route === 'setup') go('home');
  }, [loaded, needsSetup, route, go]);

  // Optional photo backup after each successful sync (no-op unless the setting is on and signed in).
  useEffect(() => {
    if (syncedAt) void backupPendingPhotos().catch(() => {});
  }, [syncedAt]);

  // Drop the edit hand-off whenever we leave 'add' (e.g. browser back).
  useEffect(() => { if (route !== 'add') setEditing(null); }, [route]);

  if (lockState === 'locked') return <Lock onUnlock={() => setLockState('open')} />;
  if (lockState === 'error') {
    return <div className="scene app-shell"><Glass role="alert" style={{ borderRadius: 24, padding: 20, color: '#FFFFFF', textAlign: 'center' }}>{t('lock.checkFailed')}</Glass></div>;
  }
  if (!loaded || lockState === 'checking') return <div className="scene app-shell" />;
  if (route === 'join') return <div className="scene app-shell"><Join onGo={go} /></div>;
  if (route === 'setup' || needsSetup) {
    return (
      <div className="scene app-shell">
        {firstRun === 'welcome'
          ? <Welcome onSetup={() => setFirstRun('setup')} onDone={() => go('home')} />
          : <Setup onGo={go} />}
      </div>
    );
  }
  if (route === 'add') {
    const editing = getEditing();
    return <div className="scene app-shell"><AddEntry key={editing?.id ?? 'new'} onGo={go} initial={editing ?? undefined} /></div>;
  }
  if (route === 'owe') return <div className="scene app-shell"><Owe onGo={go} /></div>;
  if (route === 'home' || route === 'history' || route === 'reports' || route === 'bills') {
    return (
      <div className="scene app-shell">
        {route === 'home' ? <Home onGo={go} /> : route === 'history' ? <History onGo={go} /> : route === 'bills' ? <Bills onGo={go} /> : <Reports />}
        <TabBar current={route} onGo={go} />
      </div>
    );
  }
  if (route === 'settings') {
    return (
      <div className="scene app-shell">
        <Settings onGo={go} />
        <TabBar current={route} onGo={go} />
      </div>
    );
  }
  return (
    <div className="scene app-shell">
      <Glass className="coming-soon" style={{ borderRadius: 24 }}>
        {route} — {t('app.comingSoon')}
      </Glass>
      <TabBar current={route} onGo={go} />
    </div>
  );
}
