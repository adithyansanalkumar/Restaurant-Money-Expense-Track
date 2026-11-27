import { useCallback, useEffect, useRef, useState } from 'react';
import { Glass } from '../ui/Glass';
import type { Route } from '../ui/router';
import type { Id, Supplier } from '../domain/types';
import { listLive } from '../db/repo';
import { db } from '../db/db';
import { restorePhoto } from '../photos/backup';
import { compressPhoto, deletePhoto, listPhotos, saveAllPhotos, savePhoto } from '../photos/photos';
import { readBill } from '../ocr/ocr';
import { getGeminiKey, readBillWithGemini } from '../ocr/gemini';
import { parseReceipt, type ParsedReceipt } from '../ocr/parseReceipt';
import { t, useLanguage } from '../i18n';
import { useSettings } from '../settings/store';
import { BillCheck } from './BillCheck';
import { PhotoViewer } from './PhotoViewer';

/** missing: an entry references this photo but it is not on this phone (placeholder until restored). */
interface Thumb { id: Id; url: string; date: string; missing?: boolean }
interface Checking { photoId: Id; url?: string; parsed: ParsedReceipt; suppliers: Supplier[]; ocrFailed: boolean }

export function Bills({ onGo }: { onGo: (r: Route) => void }) {
  useLanguage();
  const { shared } = useSettings();
  const lang = shared?.billLanguage ?? 'fra';
  const input = useRef<HTMLInputElement>(null);
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [reading, setReading] = useState(false);
  const [checking, setChecking] = useState<Checking | null>(null);
  const [viewing, setViewing] = useState<Id | null>(null);
  const [notice, setNotice] = useState('');

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async () => {
    const rows = await listPhotos();
    const have = new Set(rows.map((r) => r.id));
    const lacking = new Map<Id, string>();
    await db.entries.each((e) => { if (!e.deleted && e.photoId && !have.has(e.photoId)) lacking.set(e.photoId, e.date); });
    if (!alive.current) return;
    setThumbs((old) => {
      old.forEach((x) => { if (x.url) try { URL.revokeObjectURL(x.url); } catch { /* ignore */ } });
      const local = rows.map((r) => {
        let url = '';
        try { url = URL.createObjectURL(r.blob); } catch { /* no preview */ }
        return { id: r.id, url, date: new Date(r.createdAt).toISOString().slice(0, 10) };
      });
      return [...local, ...[...lacking].map(([id, date]) => ({ id, url: '', date, missing: true }))];
    });
    // bring backed-up photos back (new phone): one at a time, then show what came back
    let restored = false;
    for (const id of lacking.keys()) {
      if (!alive.current) return;
      if (await restorePhoto(id)) restored = true;
    }
    if (restored && alive.current) await load();
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { setThumbs((old) => { old.forEach((x) => { try { URL.revokeObjectURL(x.url); } catch { /* ignore */ } }); return []; }); }, []);
  useEffect(() => () => { if (checking?.url) try { URL.revokeObjectURL(checking.url); } catch { /* ignore */ } }, [checking?.url]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setReading(true); setNotice('');
    try {
      const blob = await compressPhoto(file);
      const photoId = await savePhoto(blob);
      const suppliers = await listLive<Supplier>('suppliers');
      let parsed: ParsedReceipt = {};
      let ocrFailed = false;
      let viaDevice = true;
      if (shared?.ocrMode === 'gemini' && navigator.onLine !== false) {
        const key = await getGeminiKey().catch(() => null);
        if (key) {
          try { parsed = await readBillWithGemini(blob, key, suppliers); viaDevice = false; } catch { setNotice(t('bills.geminiFallback')); }
        }
      }
      if (viaDevice) { try { parsed = parseReceipt(await readBill(blob, lang), lang, suppliers); } catch { ocrFailed = true; } }
      let url: string | undefined;
      try { url = URL.createObjectURL(blob); } catch { /* ignore */ }
      setChecking({ photoId, url, parsed, suppliers, ocrFailed });
    } catch {
      setNotice(t('bills.saveError'));
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  };

  const retake = () => {
    input.current?.click(); // synchronously, inside the tap: iOS blocks pickers opened after an await
    const old = checking;
    setChecking(null);
    void (async () => { if (old) await deletePhoto(old.photoId); await load(); })();
  };
  const closeCheck = () => { setChecking(null); void load(); };

  const saveAll = async () => {
    try { const n = await saveAllPhotos(); setNotice(t('bills.savedAll', { n })); } catch { setNotice(t('bills.saveError')); }
  };

  const picker = (
    <input ref={input} type="file" accept="image/*" capture="environment" data-testid="bill-input" aria-label={t('bills.take')}
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      onChange={(e) => void onPick(e.target.files?.[0])} />
  );

  // The picker lives at one stable position so the same DOM input survives check <-> grid switches
  // (Retake opens the OS dialog, then the grid re-renders; its `change` must reach this input).
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520, margin: '0 auto' }}>
      {picker}
      {checking && notice && <div role="status" style={{ textAlign: 'center', fontSize: 13, color: '#C6D8E6' }}>{notice}</div>}
      {checking ? (
        <BillCheck photoId={checking.photoId} photoUrl={checking.url} parsed={checking.parsed} suppliers={checking.suppliers}
          ocrFailed={checking.ocrFailed} onRetake={retake} onClose={closeCheck} onGo={onGo} />
      ) : (
        <>
      <h1 style={{ margin: 0, fontFamily: "'Inter Tight', sans-serif", fontSize: 26, fontWeight: 800 }}>{t('bills.title')}</h1>
      <button type="button" className="glass" disabled={reading} onClick={() => input.current?.click()} style={{
        minHeight: 96, borderRadius: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#FFFFFF', font: '800 17px Inter, sans-serif',
      }}>
        <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
        {reading ? t('bills.reading') : t('bills.take')}
      </button>
      {reading && <div role="status" style={{ textAlign: 'center', fontSize: 13, color: '#C6D8E6' }}>{t('bills.reading')}</div>}
      {notice && <div role="status" style={{ textAlign: 'center', fontSize: 13, color: '#C6D8E6' }}>{notice}</div>}
      {thumbs.length === 0 ? (
        <Glass style={{ borderRadius: 22, padding: 18, fontSize: 13, color: '#A9BED0', textAlign: 'center' }}>{t('bills.empty')}</Glass>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            {thumbs.map((p) => (
              <button key={p.id} type="button" data-testid="bill-thumb" aria-label={t('bills.openBill', { date: p.date })} onClick={() => setViewing(p.id)}
                style={{ aspectRatio: '3 / 4', minHeight: 44, border: '1px solid rgba(255,255,255,0.24)', borderRadius: 14, padding: 0, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
                {p.url && <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                {p.missing && <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 8, fontSize: 11, lineHeight: 1.3, color: '#B3C8D9', textAlign: 'center' }}>{t('bills.notOnPhone')}</span>}
              </button>
            ))}
          </div>
          <button type="button" className="glass" onClick={() => void saveAll()} style={{ minHeight: 52, borderRadius: 26, font: '700 15px Inter, sans-serif', color: '#FFFFFF' }}>{t('bills.saveAll')}</button>
        </>
      )}
      {viewing && <PhotoViewer photoId={viewing} onClose={() => setViewing(null)} onGo={onGo} />}
        </>
      )}
    </div>
  );
}
