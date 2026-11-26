import { t } from '../../i18n';
import { useMoney } from '../useMoney';

type Pt = { label: string; in: number; out: number; profit: number };
const W = 320, H = 120;

export function ProfitBars({ data }: { data: Pt[] }) {
  const { fmt } = useMoney();
  const maxPos = Math.max(0, ...data.map((d) => d.profit));
  const maxNeg = Math.max(0, ...data.map((d) => -d.profit));
  const span = Math.max(1, maxPos + maxNeg);
  const zero = 6 + (maxPos / span) * (H - 12);
  const unit = (H - 12) / span;
  const slot = data.length ? W / data.length : W;
  const bw = Math.min(28, slot * 0.6);
  const best = data.reduce<Pt | null>((b, d) => (b === null || d.profit > b.profit ? d : b), null);
  const worst = data.reduce<Pt | null>((b, d) => (b === null || d.profit < b.profit ? d : b), null);
  const label = best && worst ? t('chart.profit', { best: `${best.label} ${fmt(best.profit, { sign: true })}`, worst: `${worst.label} ${fmt(worst.profit, { sign: true })}` }) : t('chart.empty');
  return (
    <svg role="img" aria-label={label} width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <line x1="0" x2={W} y1={zero} y2={zero} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      {data.map((d, i) => {
        const neg = d.profit < 0;
        const h = Math.max(d.profit === 0 ? 0 : 2, Math.abs(d.profit) * unit);
        return (
          <rect key={d.label} data-sign={neg ? 'neg' : 'pos'} x={i * slot + (slot - bw) / 2} width={bw}
            y={neg ? zero : zero - h} height={h} rx="4" fill={neg ? '#FF8E8E' : '#6FE3A0'}>
            <title>{`${d.label} ${fmt(d.profit, { sign: true })}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
