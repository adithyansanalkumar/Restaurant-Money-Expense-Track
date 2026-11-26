import { useCallback, useEffect, useRef, useState } from 'react';
import { Glass } from '../ui/Glass';
import type { Route } from '../ui/router';
import type { Id, Supplier } from '../domain/types';
import { listLive } from '../db/repo';
import { compressPhoto, deletePhoto, listPhotos, saveAllPhotos, savePhoto } from '../photos/photos';
import { readBill } from '../ocr/ocr';
import { parseReceipt, type ParsedReceipt } from '../ocr/parseReceipt';
import { t, useLanguage } from '../i18n';
import { useSettings } from '../settings/store';
import { BillCheck } from './BillCheck';
import { PhotoViewer } from './PhotoViewer';

interface Thumb { id: Id; url: string; date: string }
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

  const load = useCallback(async () => {
    const rows = await listPhotos();
    setThumbs((old) => {
      old.forEach((x) => { try { URL.revokeObjectURL(x.url); } catch { /* ignore */ } });
      return rows.map((r) => {
        let url = '';
        try { url = URL.createObjectURL(r.blob); } catch { /* no preview */ }
        return { id: r.id, url, date: new Date(r.createdAt).toISOString().slice(0, 10) };
      });
    });
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { setThumbs((old) => { old.forEach((x) => { try { URL.revokeObjectURL(x.url); } catch { /* ignore */ } }); return []; }); }, []);
  useEffect(() => () => { if (checking?.url) try { URL.revokeObjectURL(checking.url); } catch { /* ignore */ } }, [checking?.url]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const blob = await compressPhoto(file);
      const photoId = await savePhoto(blob);
      const suppliers = await listLive<Supplier>('suppliers');
      let parsed: ParsedReceipt = {};
      let ocrFailed = false;
      try { parsed = parseReceipt(await readBill(blob, lang), lang, suppliers); } catch { ocrFailed = true; }
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

  if (checking) {
    return (
      <>
        {picker}
        <BillCheck photoId={checking.photoId} photoUrl={checking.url} parsed={checking.parsed} suppliers={checking.suppliers}
          ocrFailed={checking.ocrFailed} onRetake={retake} onClose={closeCheck} onGo={onGo} />
      </>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520, margin: '0 auto' }}>
      <h1 style={{ margin: 0, fontFamily: "'Inter Tight', sans-serif", fontSize: 26, fontWeight: 800 }}>{t('bills.title')}</h1>
      {picker}
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
              </button>
            ))}
          </div>
          <button type="button" className="glass" onClick={() => void saveAll()} style={{ minHeight: 52, borderRadius: 26, font: '700 15px Inter, sans-serif', color: '#FFFFFF' }}>{t('bills.saveAll')}</button>
        </>
      )}
      {viewing && <PhotoViewer photoId={viewing} onClose={() => setViewing(null)} onGo={onGo} />}
    </div>
  );
}
