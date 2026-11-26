import { useCallback, useEffect } from 'react';
import { Glass } from './ui/Glass';
import { TabBar } from './ui/TabBar';
import { useRoute, type Route } from './ui/router';
import { Setup } from './screens/Setup';
import { Home } from './screens/Home';
import { History } from './screens/History';
import { getEditing, setEditing } from './ui/editing';
import { AddEntry } from './screens/AddEntry';
import { t, useLanguage } from './i18n';
import { useSettings } from './settings/store';

export function App() {
  useLanguage();
  const [route, rawGo] = useRoute();
  const go = useCallback((r: Route) => { if (r !== 'add') setEditing(null); rawGo(r); }, [rawGo]);
  const { loaded, shared } = useSettings();
  const needsSetup = loaded && !shared;

  useEffect(() => {
    useEffect(() => { if (route !== 'add') setEditing(null); }, [route]);

  if (!loaded) return;
    if (needsSetup && route !== 'setup' && route !== 'join') go('setup');
    else if (!needsSetup && route === 'setup') go('home');
  }, [loaded, needsSetup, route, go]);

  if (!loaded) return <div className="scene app-shell" />;
  if (route === 'setup' || (needsSetup && route !== 'join')) {
    return <div className="scene app-shell"><Setup onGo={go} /></div>;
  }
  if (route === 'add') {
    const editing = getEditing();
    return <div className="scene app-shell"><AddEntry key={editing?.id ?? 'new'} onGo={go} initial={editing ?? undefined} /></div>;
  }
  if (route === 'home' || route === 'history') {
    return (
      <div className="scene app-shell">
        {route === 'home' ? <Home onGo={go} /> : <History onGo={go} />}
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
