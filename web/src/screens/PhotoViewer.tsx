import { useEffect, useState } from 'react';
import type { Route } from '../ui/router';
import { setEditing } from '../ui/editing';
import type { Entry, Id } from '../domain/types';
import { db } from '../db/db';
import { getPhoto, savePhotoToPhone } from '../photos/photos';
import { restorePhoto } from '../photos/backup';
import { t, useLanguage } from '../i18n';

/** Full-screen bill photo with "Save to phone" and, when linked, a way to the expense. */
export function PhotoViewer({ photoId, onClose, onGo }: { photoId: Id; onClose: () => void; onGo: (r: Route) => void }) {
  useLanguage();
  const [url, setUrl] = useState<string>();
  const [entry, setEntry] = useState<Entry>();
  const [error, setError] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    let made: string | undefined;
    void (async () => {
      // not on this phone: bring it back from this account's Drive backup when there is one
      const blob = (await getPhoto(photoId)) ?? (await restorePhoto(photoId)) ?? undefined;
      if (!blob && live) setMissing(true);
      if (blob && live) { try { made = URL.createObjectURL(blob); setUrl(made); } catch { /* no preview */ } }
      const e = await db.entries.filter((x) => !x.deleted && x.photoId === photoId).first();
      if (live) setEntry(e);
    })();
    return () => { live = false; if (made) try { URL.revokeObjectURL(made); } catch { /* ignore */ } };
  }, [photoId]);

  const save = async () => {
    setError(false);
    try { await savePhotoToPhone(photoId); } catch { setError(true); }
  };
  const open = () => { if (entry) { setEditing(entry); onClose(); onGo('add'); } };

  return (
    <div role="dialog" aria-modal="true" aria-label={t('bills.photoAlt')}
      style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(2,10,24,0.92)', display: 'flex', flexDirection: 'column', padding: 16, gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button type="button" className="glass" aria-label={t('bills.close')} onClick={onClose}
          style={{ width: 44, height: 44, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF' }}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {entry && (
          <button type="button" onClick={open} style={{ minHeight: 44, padding: '0 14px', border: 0, background: 'transparent', color: '#8FD8F2', font: '600 14px Inter, sans-serif', textDecoration: 'underline' }}>{t('bills.viewExpense')}</button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {missing && (
          <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: '#B3C8D9', fontSize: 14, textAlign: 'center' }}>
            <svg aria-hidden="true" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
            {t('bills.notOnPhone')}
          </div>
        )}
        {url && <img src={url} alt={t('bills.photoAlt')} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }} />}
      </div>
      {error && <div role="alert" style={{ color: '#FF8E8E', fontSize: 13, textAlign: 'center' }}>{t('bills.saveError')}</div>}
      <button type="button" className="glass" disabled={missing} onClick={() => void save()}
        style={{ minHeight: 52, borderRadius: 26, font: '700 15px Inter, sans-serif', color: '#FFFFFF' }}>{t('bills.saveToPhone')}</button>
    </div>
  );
}
