import { t } from '../../i18n';
import { useMoney } from '../useMoney';

/** key: a stable unique id (category id, or 'other'); labels can repeat (a category named "Other"). */
export interface Slice { key?: string; label: string; cents: number; color: string }
const R = 40, C = 2 * Math.PI * R;

export function Donut({ slices, centerLabel, centerValue }: { slices: Slice[]; centerLabel: string; centerValue: string }) {
  const { fmt } = useMoney();
  const total = slices.reduce((s, x) => s + x.cents, 0);
  let offset = 0;
  const arcs = total === 0 ? [] : slices.map((s, i) => ({ ...s, key: s.key ?? `i${i}` })).filter((s) => s.cents > 0).map((s) => {
    const len = (s.cents / total) * C;
    const arc = { ...s, len, offset };
    offset += len;
    return arc;
  });
  const label = t('chart.donut', { center: `${centerLabel} ${centerValue}`, parts: slices.map((s) => `${s.label} ${fmt(s.cents)}`).join(', ') });
  return (
    <svg role="img" aria-label={label} width="140" height="140" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="14" />
      <g transform="rotate(-90 50 50)">
        {arcs.map((a) => (
          <circle key={a.key} data-arc={a.len} cx="50" cy="50" r={R} fill="none" stroke={a.color} strokeWidth="14"
            strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={-a.offset} />
        ))}
      </g>
      <text x="50" y="47" textAnchor="middle" fontSize="7" fill="#C6D8E6">{centerLabel}</text>
      <text x="50" y="58" textAnchor="middle" fontSize="10" fontWeight="800" fill="#FFFFFF">{centerValue}</text>
    </svg>
  );
}
