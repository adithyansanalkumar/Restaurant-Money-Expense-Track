import { useCallback, useEffect, useMemo, useState } from 'react';
import { Glass } from '../ui/Glass';
import type { Route } from '../ui/router';
import { setEditing } from '../ui/editing';
import { useMoney } from '../ui/useMoney';
import { shownAmount } from '../domain/totals';
import type { Category, Entry, Payment, Supplier } from '../domain/types';
import { db } from '../db/db';
import { listLive, softDelete } from '../db/repo';
import { t, useLanguage } from '../i18n';
import { useSyncStatus } from '../sync/sync';
import { PhotoViewer } from './PhotoViewer';

const IN = '#6FE3A0';
const OUT = '#FF8E8E';

export function History({ onGo }: { onGo: (r: Route) => void }) {
  useLanguage();
  const { fmt, view } = useMoney();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Entry | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const { revision } = useSyncStatus();

  const load = useCallback(async () => {
    const [e, s, c] = await Promise.all([listLive<Entry>('entries'), listLive<Supplier>('suppliers'), listLive<Category>('categories')]);
    setEntries(e); setSuppliers(s); setCategories(c);
  }, []);
  useEffect(() => { void load(); }, [load, revision]); // revision: a sync changed rows

  const supplierName = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? '';
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';
  const title = (e: Entry) => (e.kind === 'income' ? (e.channel || catName(e.categoryId) || t('history.collection')) : (supplierName(e.supplierId) || catName(e.categoryId)));

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...entries]
      .filter((e) => !q || supplierName(e.supplierId).toLowerCase().includes(q) || (e.note ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.updatedAt - a.updatedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, suppliers, query]);

  const confirmDelete = async () => {
    const e = pending;
    if (!e) return;
    await db.transaction('rw', [db.entries, db.payments, db.meta], async () => {
      await softDelete('entries', e.id);
      const pays = await db.payments.where('entryId').equals(e.id).toArray();
      for (const p of pays as Payment[]) if (!p.deleted) await softDelete('payments', p.id);
    });
    setPending(null);
    await load();
  };

  const edit = (e: Entry) => { setEditing(e); onGo('add'); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="glass" aria-label={t('history.back')} onClick={() => onGo('home')}
          style={{ width: 44, height: 44, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1 style={{ margin: 0, fontFamily: "'Inter Tight', sans-serif", fontSize: 26, fontWeight: 800 }}>{t('history.title')}</h1>
      </div>
      <input className="field" type="search" aria-label={t('history.search')} placeholder={t('history.search')} value={query}
        onChange={(e) => setQuery(e.target.value)} style={{ height: 44, borderRadius: 14, padding: '0 14px', font: '500 14px Inter, sans-serif', color: '#FFFFFF' }} />
      <Glass style={{ borderRadius: 22, padding: '6px 14px', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 && <div style={{ fontSize: 13, color: '#A9BED0', padding: '14px 0' }}>{t('history.empty')}</div>}
        {rows.map((e, i) => {
          const income = e.kind === 'income';
          const { cents, fallback } = shownAmount(e, view);
          return (
            <div key={e.id} data-testid="history-row" style={{ display: 'flex', alignItems: 'center', gap: 4, borderTop: i ? '1px solid rgba(255,255,255,0.12)' : undefined }}>
              <button type="button" aria-label={`${t('history.edit')}: ${title(e)}`} onClick={() => edit(e)} style={{
                flex: 1, minHeight: 56, display: 'flex', alignItems: 'center', gap: 12, border: 0, background: 'transparent', color: '#FFFFFF', textAlign: 'left', padding: '6px 0',
              }}>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{title(e)}</span>
                  <span style={{ fontSize: 12, color: '#A9BED0' }}>{[e.date, e.note].filter(Boolean).join(' · ')}</span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: income ? IN : OUT }}>{income ? fmt(cents, { sign: true }) : fmt(-cents)}</span>
                  {fallback && <span data-testid="incl-tag" style={{ fontSize: 11, color: '#A9BED0' }}>{t('tax.inclTag')}</span>}
                </span>
              </button>
              {e.photoId && (
                <button type="button" aria-label={t('bills.viewPhoto')} onClick={() => setPhoto(e.photoId!)} style={{ width: 44, height: 44, border: 0, background: 'transparent', color: '#8FD8F2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
                </button>
              )}
              <button type="button" aria-label={t('history.delete')} onClick={() => setPending(e)} style={{ width: 44, height: 44, border: 0, background: 'transparent', color: '#C6D8E6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
              </button>
            </div>
          );
        })}
      </Glass>

      {photo && <PhotoViewer photoId={photo} onClose={() => setPhoto(null)} onGo={onGo} />}

      {pending && (
        <div role="dialog" aria-modal="true" aria-label={t('history.deleteConfirm')} onClick={() => setPending(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,10,24,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20, padding: 18 }}>
          <Glass strong onClick={(ev) => ev.stopPropagation()} style={{ width: '100%', maxWidth: 360, borderRadius: 24, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{t('history.deleteConfirm')}</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setPending(null)} style={{ flex: 1, minHeight: 48, borderRadius: 24, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', fontWeight: 600 }}>{t('history.cancel')}</button>
              <button type="button" onClick={() => void confirmDelete()} style={{ flex: 1, minHeight: 48, borderRadius: 24, border: 0, background: OUT, color: '#3D0A0A', fontWeight: 800 }}>{t('history.confirm')}</button>
            </div>
          </Glass>
        </div>
      )}
    </div>
  );
}
