import { useEffect } from 'react';
import { Glass } from './ui/Glass';
import { TabBar } from './ui/TabBar';
import { useRoute } from './ui/router';
import { Setup } from './screens/Setup';
import { AddEntry } from './screens/AddEntry';
import { t, useLanguage } from './i18n';
import { useSettings } from './settings/store';

export function App() {
  useLanguage();
  const [route, go] = useRoute();
  const { loaded, shared } = useSettings();
  const needsSetup = loaded && !shared;

  useEffect(() => {
    if (!loaded) return;
    if (needsSetup && route !== 'setup' && route !== 'join') go('setup');
    else if (!needsSetup && route === 'setup') go('home');
  }, [loaded, needsSetup, route, go]);

  if (!loaded) return <div className="scene app-shell" />;
  if (route === 'setup' || (needsSetup && route !== 'join')) {
    return <div className="scene app-shell"><Setup onGo={go} /></div>;
  }
  if (route === 'add') {
    return <div className="scene app-shell"><AddEntry onGo={go} /></div>;
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
