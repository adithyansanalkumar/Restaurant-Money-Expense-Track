import { t } from '../i18n';

const keyStyle = { height: 54, minWidth: 44, borderRadius: 20, font: "600 24px 'Inter Tight', sans-serif", color: '#FFFFFF' } as const;

interface Props {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  /** Optional extra control in the bottom-left cell (e.g. biometric button). */
  extra?: React.ReactNode;
  disabled?: boolean;
  shake?: boolean;
}

export function PinPad({ value, onChange, maxLength = 6, extra, disabled = false, shake = false }: Props) {
  const add = (d: string) => { if (!disabled && value.length < maxLength) onChange(value + d); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignSelf: 'stretch' }}>
      <div role="img" aria-label={t('lock.pinDots', { n: value.length })} className={shake ? 'pin-shake' : undefined}
        style={{ display: 'flex', justifyContent: 'center', gap: 14, height: 20 }}>
        {Array.from({ length: Math.max(4, value.length) }, (_, i) => (
          <span key={i} data-testid="pin-dot" data-filled={i < value.length ? 'true' : 'false'} style={{
            width: 16, height: 16, borderRadius: 8, border: '1.5px solid #FFFFFF',
            background: i < value.length ? '#FFFFFF' : 'transparent',
          }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="key" style={keyStyle} disabled={disabled} aria-label={d} onClick={() => add(d)}>{d}</button>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{extra}</div>
        <button type="button" className="key" style={keyStyle} disabled={disabled} aria-label="0" onClick={() => add('0')}>0</button>
        <button type="button" className="key" aria-label={t('lock.delete')} disabled={disabled} onClick={() => onChange(value.slice(0, -1))}
          style={{ ...keyStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M21 5H9l-6 7 6 7h12z" /><path d="M13 9l5 6M18 9l-5 6" /></svg>
        </button>
      </div>
    </div>
  );
}

export const primaryBtn = {
  alignSelf: 'stretch', height: 58, borderRadius: 29, border: 0,
  background: 'linear-gradient(160deg, #FFFFFF 0%, #DDF2FB 100%)',
  boxShadow: 'inset 0 1px 0 #FFFFFF, 0 14px 30px rgba(2,10,24,0.45)',
  color: '#1B365D', fontSize: 17, fontWeight: 800,
} as const;
