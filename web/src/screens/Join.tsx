import { useEffect, useState } from 'react';
import { Glass } from '../ui/Glass';
import type { Route } from '../ui/router';
import { t, useLanguage } from '../i18n';
import { primaryBtn } from '../lock/PinPad';
import { useSignIn } from '../ui/useSignIn';
import { SignInPrompts } from '../ui/ConsentNotice';
import { currentEmail, signOut } from '../sync/auth';
import { isAdoptPending } from '../sync/sync';
import { JOIN_MODE, openShared } from '../sync/share';
import { otherOwner } from '../sync/onboard';
import { db } from '../db/db';
import { useSettings } from '../settings/store';
import { errorText, iconTile, linkBtn, mutedText, noticeText, screenCol, screenTitle } from '../ui/styles';

const isNamed = (e: unknown, name: string) => (e as Error | undefined)?.name === name;

/** Join someone else's restaurant with your own Google account (writes device settings only). */
export function Join({ onGo }: { onGo: (r: Route) => void }) {
  useLanguage();
  const { device, saveDevice } = useSettings();
  const s = useSignIn();
  const signingIn = s.busy;
  const [email, setEmail] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // this phone holds someone else's restaurant but no ledger is chosen (it signed out): reopen it
  const [reopen, setReopen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void currentEmail().then((e) => { if (live) setEmail(e); }, () => {});
    void (async () => {
      const owner = await otherOwner();
      const ref = await db.meta.get('ledgerRef');
      if (live) setReopen(owner && !ref ? owner : null);
    })().catch(() => {});
    return () => { live = false; };
  }, [email]);

  const doSignIn = async (viaReset = false) => {
    setError(null);
    try {
      const r = viaReset ? await s.resetAndRetry() : await s.run();
      if (r) setEmail(r.email);
    } catch { setError(t('auth.error')); }
  };

  // Leaving without joining: a sign-in made here (adoptPending) is undone, so Setup can't run
  // signed in with this account's Drive unchecked.
  const back = async () => {
    try { if (await isAdoptPending()) await signOut(); } catch { /* local sign-out still happened */ }
    onGo('setup');
  };

  const choose = async () => {
    if (working) return;
    setError(null);
    setWorking(true);
    try {
      await openShared();
      await saveDevice({ appLanguage: device.appLanguage });
      onGo('home');
    } catch (e) {
      if (isNamed(e, 'PickerCancelled')) return;
      setError(isNamed(e, 'NoLedger') ? t('join.noLedger') : isNamed(e, 'NoRestaurant') ? t('join.noRestaurant') : t('join.error'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="join" style={screenCol}>
      <div style={{ alignSelf: 'stretch' }}>
        <button type="button" style={{ ...linkBtn, textDecoration: 'none', minWidth: 44 }} onClick={() => void back()}><span aria-hidden="true">‹ </span>{t('join.back')}</button>
      </div>
      <Glass style={iconTile}>
        <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M17 8v6M14 11h6" /></svg>
      </Glass>
      <div style={screenTitle}>{t('join.title')}</div>
      <div style={{ ...mutedText, fontSize: 14, marginTop: -6 }}>{t('join.subtitle')}</div>
      <Glass style={{ alignSelf: 'stretch', borderRadius: 28, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {reopen && <div role="status" style={noticeText}>{t('join.reopen', { owner: reopen })}</div>}
        {email
          ? <>
              <div style={mutedText}>{t('auth.signedInAs', { email })}</div>
              <button type="button" style={primaryBtn} disabled={working} onClick={() => void choose()}>
                {JOIN_MODE === 'folder' ? t('join.pickFolder') : t('join.pickFile')}
              </button>
            </>
          : <button type="button" style={primaryBtn} disabled={signingIn} onClick={() => void doSignIn()}>{t('auth.signIn')}</button>}
        {!email && <SignInPrompts s={s} onContinue={() => void doSignIn()} onReset={() => void doSignIn(true)} />}
        {working && <div role="status" style={noticeText}>{t('join.working')}</div>}
        {error && <div role="alert" style={errorText}>{error}</div>}
      </Glass>
    </div>
  );
}
