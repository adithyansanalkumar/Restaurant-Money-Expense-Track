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
import { hasPin, shouldLock } from './lock/lock';

export function App() {
  useLanguage();
  const [route, rawGo] = useRoute();
  const go = useCallback((r: Route) => { if (r !== 'add') setEditing(null); rawGo(r); }, [rawGo]);
  const { loaded, shared } = useSettings();
  const needsSetup = loaded && !shared;
  // 'checking' until we know whether a PIN exists; while 'locked' nothing else renders.
  const [lockState, setLockState] = useState<'checking' | 'locked' | 'open'>('checking');
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    void hasPin().then((p) => { if (live) setLockState(p ? 'locked' : 'open'); }, () => { if (live) setLockState('open'); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return; }
      const at = hiddenAt.current;
      hiddenAt.current = null;
      if (at !== null && shouldLock(at, Date.now())) {
        void hasPin().then((p) => { if (p) setLockState('locked'); });
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

  // Drop the edit hand-off whenever we leave 'add' (e.g. browser back).
  useEffect(() => { if (route !== 'add') setEditing(null); }, [route]);

  if (lockState === 'locked') return <Lock onUnlock={() => setLockState('open')} />;
  if (!loaded || lockState === 'checking') return <div className="scene app-shell" />;
  if (route === 'setup' || (needsSetup && route !== 'join')) {
    return <div className="scene app-shell"><Setup onGo={go} /></div>;
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
  return (
    <div className="scene app-shell">
      <Glass className="coming-soon" style={{ borderRadius: 24 }}>
        {route} — {t('app.comingSoon')}
      </Glass>
      {route !== 'join' && <TabBar current={route} onGo={go} />}
    </div>
  );
}
