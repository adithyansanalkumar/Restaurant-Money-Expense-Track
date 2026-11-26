import type { CSSProperties } from 'react';

export interface SegOption<V extends string> { value: V; label: string; activeBg?: string; activeColor?: string }

export function Segmented<V extends string>({ options, value, onChange, label, glass = false, small = false }: {
  options: SegOption<V>[]; value: V; onChange: (v: V) => void; label: string; glass?: boolean; small?: boolean;
}) {
  const wrap: CSSProperties = glass
    ? { display: 'flex', padding: 4, borderRadius: 22 }
    : { display: 'flex', background: 'rgba(0,0,0,0.18)', borderRadius: 14, padding: 3 };
  return (
    <div role="group" aria-label={label} className={glass ? 'glass' : undefined} style={wrap}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)} style={{
            minHeight: 44, padding: '0 14px', border: 0, borderRadius: small ? 11 : 18,
            background: on ? (o.activeBg ?? '#FFFFFF') : 'transparent',
            font: `${on ? 700 : 500} ${small ? 12 : 13}px Inter, sans-serif`,
            color: on ? (o.activeColor ?? '#1B365D') : '#DCE8F1',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}
