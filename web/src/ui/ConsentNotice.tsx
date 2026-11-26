import { t } from '../i18n';
import { primaryBtn } from '../lock/PinPad';
import { noticeText } from './styles';
import { secondaryBtn } from './styles';

/** "Please approve access again" + a button that re-runs sign-in from this tap. */
export function ConsentNotice({ onContinue, disabled }: { onContinue: () => void; disabled?: boolean }) {
  return (
    <>
      <div role="status" style={noticeText}>{t('auth.reconsent')}</div>
      <button type="button" style={primaryBtn} disabled={disabled} onClick={onContinue}>{t('auth.continueGoogle')}</button>
    </>
  );
}

interface PromptState { consent: boolean; switchTo: string | null; switchWarn?: boolean; busy: boolean; cancelSwitch: () => void }

/** The prompts a guarded sign-in can end in (see useGuardedSignIn). */
export function SignInPrompts({ s, onContinue, onReset }: { s: PromptState; onContinue: () => void; onReset: () => void }) {
  return (
    <>
      {s.consent && <ConsentNotice disabled={s.busy} onContinue={onContinue} />}
      {s.switchTo && (
        <div role="alertdialog" aria-label={t('switch.title', { email: s.switchTo })} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...noticeText, color: '#FFFFFF' }}>{t('switch.title', { email: s.switchTo })}</div>
          {s.switchWarn && <div role="alert" style={{ ...noticeText, color: '#FF8E8E' }}>{t('switch.unsynced')}</div>}
          <button type="button" style={primaryBtn} disabled={s.busy} onClick={onReset}>{t('switch.reset')}</button>
          <button type="button" style={secondaryBtn} disabled={s.busy} onClick={s.cancelSwitch}>{t('switch.cancel')}</button>
        </div>
      )}
    </>
  );
}
