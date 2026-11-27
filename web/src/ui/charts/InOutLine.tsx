import { t } from '../../i18n';
import { useMoney } from '../useMoney';

type Pt = { label: string; in: number; out: number; profit: number };
const W = 320, H = 96, PAD = 8;

export function InOutLine({ data }: { data: Pt[] }) {
  const { fmt } = useMoney();
  const max = Math.max(1, ...data.flatMap((d) => [d.in, d.out]));
  const x = (i: number) => (data.length < 2 ? W / 2 : (i / (data.length - 1)) * W);
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const path = (k: 'in' | 'out') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  const totalIn = data.reduce((s, d) => s + d.in, 0);
  const totalOut = data.reduce((s, d) => s + d.out, 0);
  const last = data[data.length - 1];
  const gid = 'inout-fill';
  return (
    <svg role="img" aria-label={t('chart.inOut', { in: fmt(totalIn), out: fmt(totalOut) })}
      width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6FE3A0" stopOpacity="0.45" /><stop offset="1" stopColor="#6FE3A0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {data.length >= 2 && <path d={`${path('in')} L${W},${H} L0,${H} Z`} fill={`url(#${gid})`} />}
      {data.length >= 2 && <path d={path('in')} fill="none" stroke="#6FE3A0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      {data.length >= 2 && <path d={path('out')} fill="none" stroke="#FF8E8E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      {last && <circle cx={x(data.length - 1)} cy={y(last.in)} r="4" fill="#6FE3A0" />}
      {last && <circle cx={x(data.length - 1)} cy={y(last.out)} r="4" fill="#FF8E8E" />}
    </svg>
  );
}
