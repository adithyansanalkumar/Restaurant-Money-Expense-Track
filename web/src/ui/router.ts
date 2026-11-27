import { useCallback, useEffect, useState } from 'react';

export type Route =
  | 'home' | 'bills' | 'add' | 'reports' | 'settings'
  | 'history' | 'owe' | 'setup' | 'lock' | 'join';

const ROUTES: readonly Route[] = [
  'home', 'bills', 'add', 'reports', 'settings', 'history', 'owe', 'setup', 'lock', 'join',
];

export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'home';
}

/** Navigate from outside a screen's onGo (e.g. the sync status line). */
export function goTo(r: Route): void {
  window.location.hash = `#/${r}`;
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((r: Route) => {
    window.location.hash = `#/${r}`;
    setRoute(r);
  }, []);
  return [route, go];
}
