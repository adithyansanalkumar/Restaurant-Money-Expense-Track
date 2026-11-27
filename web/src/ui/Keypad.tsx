import type { KeypadKey } from '../domain/keypad';
import { t } from '../i18n';

const keyStyle = { height: 54, minWidth: 44, borderRadius: 20, font: "600 24px 'Inter Tight', sans-serif", color: '#FFFFFF' } as const;

export function Keypad({ onKey, decimalSep }: { onKey: (k: KeypadKey) => void; decimalSep: ',' | '.' }) {
  const digit = (d: KeypadKey, label: string = d) => (
    <button key={d} type="button" className="key" style={keyStyle} aria-label={label} onClick={() => onKey(d)}>{label}</button>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
      {(['1', '2', '3', '4', '5', '6', '7', '8', '9'] as KeypadKey[]).map((d) => digit(d))}
      {digit(decimalSep)}
      {digit('0')}
      <button type="button" className="key" aria-label={t('add.deleteDigit')} onClick={() => onKey('⌫')}
        style={{ ...keyStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M21 5H9l-6 7 6 7h12z" /><path d="M13 9l5 6M18 9l-5 6" /></svg>
      </button>
    </div>
  );
}
