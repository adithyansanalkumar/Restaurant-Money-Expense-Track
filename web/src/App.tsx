import { Glass } from './ui/Glass';
import { TabBar } from './ui/TabBar';
import { useRoute } from './ui/router';

export function App() {
  const [route, go] = useRoute();
  return (
    <div className="scene app-shell">
      <Glass className="coming-soon" style={{ borderRadius: 24 }}>
        {route} — Coming soon
      </Glass>
      <TabBar current={route} onGo={go} />
    </div>
  );
}
