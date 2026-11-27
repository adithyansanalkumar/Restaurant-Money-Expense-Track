import { useState } from 'react';
import { t, useLanguage } from '../i18n';
import { setPin } from './lock';
import { PinPad, primaryBtn } from './PinPad';

/** Enter a new PIN twice. Reusable by Settings; `iterations` is for tests only. */
export function PinSetup({ onDone, iterations }: { onDone: () => void; iterations?: number }) {
  useLanguage();
  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<'invalid' | 'mismatch' | 'save' | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!/^\d{4,6}$/.test(value)) { setError('invalid'); return; }
    if (first === null) { setFirst(value); setValue(''); setError(null); return; }
    if (value !== first) { setFirst(null); setValue(''); setError('mismatch'); return; }
    setBusy(true);
    try { await setPin(value, iterations); onDone(); } catch { setError('save'); setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, color: '#FFFFFF' }}>
      <div style={{ fontSize: 16, fontWeight: 700, textAlign: 'center' }}>{first === null ? t('pin.new') : t('pin.confirm')}</div>
      <PinPad value={value} onChange={(v) => { setValue(v); setError(null); }} disabled={busy} />
      {error && <div role="alert" style={{ fontSize: 13, color: '#FF8E8E', textAlign: 'center' }}>
        {t(error === 'invalid' ? 'pin.invalid' : error === 'mismatch' ? 'pin.mismatch' : 'pin.error')}
      </div>}
      <button type="button" style={primaryBtn} disabled={busy} onClick={() => void submit()}>
        {first === null ? t('pin.next') : t('pin.save')}
      </button>
    </div>
  );
}
