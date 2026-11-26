import { t } from '../i18n';
import { primaryBtn } from '../lock/PinPad';
import { noticeText } from './styles';

/** "Please approve access again" + a button that re-runs sign-in from this tap. */
export function ConsentNotice({ onContinue, disabled }: { onContinue: () => void; disabled?: boolean }) {
  return (
    <>
      <div role="status" style={noticeText}>{t('auth.reconsent')}</div>
      <button type="button" style={primaryBtn} disabled={disabled} onClick={onContinue}>{t('auth.continueGoogle')}</button>
    </>
  );
}
