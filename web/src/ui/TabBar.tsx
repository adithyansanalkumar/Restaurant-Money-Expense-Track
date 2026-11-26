import type { MouseEvent, ReactNode } from 'react';
import type { Route } from './router';

const svg = (children: ReactNode, w = 22, sw = 2) => (
  <svg aria-hidden="true" width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

const TABS: { route: Route; label: string; icon: ReactNode }[] = [
  { route: 'home', label: 'Home', icon: svg(<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />) },
  { route: 'bills', label: 'Bills', icon: svg(<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>) },
  { route: 'reports', label: 'Reports', icon: svg(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />) },
  { route: 'settings', label: 'Settings', icon: svg(<><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /></>) },
];

export function TabBar({ current, onGo }: { current: Route; onGo: (r: Route) => void }) {
  const click = (r: Route) => (e: MouseEvent) => { e.preventDefault(); onGo(r); };
  const tab = (t: (typeof TABS)[number]) => {
    const active = current === t.route;
    return (
      <a key={t.route} href={`#/${t.route}`} onClick={click(t.route)}
        aria-current={active ? 'page' : undefined}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, textDecoration: 'none',
          color: active ? '#FFFFFF' : '#B3C8D9', fontSize: 10, fontWeight: active ? 700 : 500,
        }}>
        {t.icon}{t.label}
      </a>
    );
  };
  return (
    <nav className="glass-bar tab-bar" aria-label="Main">
      {tab(TABS[0])}
      {tab(TABS[1])}
      <a href="#/add" aria-label="Add" onClick={click('add')}
        style={{
          justifySelf: 'center', width: 54, height: 54, borderRadius: 27,
          background: 'linear-gradient(160deg, #8FD8F2 0%, #2E8FD0 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7), 0 10px 24px rgba(0,90,156,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF',
        }}>
        {svg(<path d="M12 5v14M5 12h14" />, 26, 2.6)}
      </a>
      {tab(TABS[2])}
      {tab(TABS[3])}
    </nav>
  );
}
