import { sanitizeAmount } from '../domain/keypad';

/**
 * The big amount at the top of Add entry / Record payment. Tapping it opens the phone's own
 * number keyboard (inputMode "decimal"); there is no on-screen keypad.
 */
export function AmountInput({ value, onChange, sep, symbol, symbolBefore, color, label }: {
  value: string;
  onChange: (v: string) => void;
  sep: ',' | '.';
  symbol: string;
  symbolBefore: boolean;
  color: string;
  label: string;
}) {
  const big = { fontFamily: "'Inter Tight', sans-serif", fontSize: 58, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.05, color } as const;
  const sym = <span aria-hidden="true" style={big}>{symbol}</span>;
  return (
    <label data-testid="amount" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6, cursor: 'text', minHeight: 64 }}>
      {symbolBefore && sym}
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={label}
        placeholder="0"
        value={value}
        onChange={(e) => onChange(sanitizeAmount(e.target.value, sep))}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{
          ...big, background: 'transparent', border: 0, outline: 'none', padding: 0, margin: 0,
          textAlign: symbolBefore ? 'left' : 'right', caretColor: color,
          width: `${Math.max(1, value.length) + 0.4}ch`, maxWidth: '75vw',
        }}
      />
      {!symbolBefore && sym}
    </label>
  );
}
