import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Glass } from '../ui/Glass';
import { listLive, put, softDelete } from '../db/repo';
import type { Category, Entry, Supplier } from '../domain/types';
import { t, useLanguage } from '../i18n';
import { useSyncStatus } from '../sync/sync';

const heading: CSSProperties = { fontSize: 15, fontWeight: 800, color: '#FFFFFF' };
const sub: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#C6D8E6', textTransform: 'uppercase', letterSpacing: 0.4 };
const input: CSSProperties = { flex: 1, minWidth: 0, height: 46, borderRadius: 14, padding: '0 12px', font: '600 14px Inter, sans-serif', color: '#FFFFFF' };
const small: CSSProperties = { minHeight: 44, minWidth: 44, padding: '0 12px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)', color: '#FFFFFF', font: '600 13px Inter, sans-serif' };
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const danger: CSSProperties = { ...small, borderColor: 'rgba(255,142,142,0.55)', color: '#FF8E8E' };
const note: CSSProperties = { fontSize: 13, color: '#DCE8F1' };

function ArchiveIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18v4H3zM5 9v10h14V9M10 13h4" /></svg>;
}
function RestoreIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10h11a5 5 0 0 1 0 10H9M4 10l4-4M4 10l4 4" /></svg>;
}
function TrashIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>;
}

/** Asks before deleting, or explains why it can't be deleted while entries still use it. */
function DeletePanel({ name, uses, canArchive, onYes, onClose }: { name: string; uses: number; canArchive: boolean; onYes: () => void; onClose: () => void }) {
  if (uses > 0) {
    return (
      <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0 6px' }}>
        <div style={note}>{t(canArchive ? 'settings.inUseArchive' : 'settings.inUse', { name, n: uses })}</div>
        <button type="button" style={{ ...small, alignSelf: 'flex-start' }} onClick={onClose}>{t('settings.ok')}</button>
      </div>
    );
  }
  return (
    <div role="alertdialog" aria-label={t('settings.delete', { name })} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0 6px' }}>
      <div style={note}>{t('settings.deleteAsk', { name })}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={danger} onClick={onYes}>{t('settings.deleteYes')}</button>
        <button type="button" style={small} onClick={onClose}>{t('settings.cancel')}</button>
      </div>
    </div>
  );
}

/** Edits the name on blur (or Enter) once it changed and is not empty. */
function NameField({ value, label, onSave, dim }: { value: string; label: string; onSave: (v: string) => void; dim?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const n = v.trim();
    if (!n) { setV(value); return; }
    if (n !== value) onSave(n);
  };
  return (
    <input className="field" aria-label={label} value={v} style={{ ...input, opacity: dim ? 0.6 : 1 }}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

function AddRow({ label, btn, onAdd }: { label: string; btn: string; onAdd: (name: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const n = v.trim();
    if (!n || busy) return;
    setBusy(true);
    try { await onAdd(n); setV(''); } finally { setBusy(false); }
  };
  return (
    <div style={row}>
      <input className="field" aria-label={label} placeholder={label} value={v} style={input}
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void go(); }} />
      <button type="button" aria-label={btn} disabled={busy || !v.trim()} onClick={() => void go()} style={{ ...small, fontWeight: 800 }}>+</button>
    </div>
  );
}

/** Categories, income channels and suppliers: add, rename, archive, delete (only when no entry uses it); suppliers get a default category. Writes sync. */
export function CategoriesEditor() {
  useLanguage();
  const { revision } = useSyncStatus();
  const [cats, setCats] = useState<Category[]>([]);
  const [sups, setSups] = useState<Supplier[]>([]);
  const [err, setErr] = useState(false);
  // How many live entries use each category / supplier: those can't be deleted (their entries would lose the name).
  const [uses, setUses] = useState<Map<string, number>>(new Map());
  const [asking, setAsking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, s, e] = await Promise.all([listLive<Category>('categories'), listLive<Supplier>('suppliers'), listLive<Entry>('entries')]);
    const n = new Map<string, number>();
    for (const x of e) {
      if (x.categoryId) n.set(x.categoryId, (n.get(x.categoryId) ?? 0) + 1);
      if (x.supplierId) n.set(x.supplierId, (n.get(x.supplierId) ?? 0) + 1);
    }
    setUses(n);
    setCats(c.sort((a, b) => a.name.localeCompare(b.name)));
    setSups(s.sort((a, b) => a.name.localeCompare(b.name)));
  }, []);
  useEffect(() => { void load(); }, [load, revision]);

  const write = async (fn: () => Promise<unknown>) => {
    setErr(false);
    try { await fn(); await load(); } catch { setErr(true); }
  };
  const saveCat = (c: Category, p: Partial<Category>) => write(() => put<Category>('categories', { ...c, ...p }));
  const addCat = (kind: Category['kind']) => (name: string) =>
    write(() => put<Category>('categories', { name, kind, archived: false }));
  const addSup = (name: string) => write(() => put<Supplier>('suppliers', { name }));
  const saveSup = (s: Supplier, p: Partial<Supplier>) => write(() => put<Supplier>('suppliers', { ...s, ...p }));
  const delCat = (c: Category) => write(async () => {
    setAsking(null);
    await softDelete('categories', c.id);
    // suppliers that defaulted to it go back to no default
    for (const s of sups) if (s.defaultCategoryId === c.id) await put<Supplier>('suppliers', { ...s, defaultCategoryId: undefined });
  });
  const delSup = (s: Supplier) => write(async () => { setAsking(null); await softDelete('suppliers', s.id); });
  const delBtn = (id: string, name: string) => (
    <button type="button" style={danger} aria-label={t('settings.delete', { name })} aria-expanded={asking === id}
      onClick={() => setAsking(asking === id ? null : id)}><TrashIcon /></button>
  );

  const group = (kind: Category['kind'], title: string, addLabel: string, addBtn: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={sub}>{title}</div>
      {cats.filter((c) => c.kind === kind).map((c) => (
        <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={row}>
            <NameField value={c.name} label={t('settings.rename', { name: c.name })} dim={c.archived} onSave={(name) => void saveCat(c, { name })} />
            {c.archived && <span style={{ fontSize: 11, color: '#B3C8D9' }}>{t('settings.archived')}</span>}
            <button type="button" style={small} aria-label={t(c.archived ? 'settings.unarchive' : 'settings.archive', { name: c.name })}
              onClick={() => void saveCat(c, { archived: !c.archived })}>{c.archived ? <RestoreIcon /> : <ArchiveIcon />}</button>
            {delBtn(c.id, c.name)}
          </div>
          {asking === c.id && <DeletePanel name={c.name} uses={uses.get(c.id) ?? 0} canArchive={!c.archived}
            onYes={() => void delCat(c)} onClose={() => setAsking(null)} />}
        </div>
      ))}
      <AddRow label={addLabel} btn={addBtn} onAdd={addCat(kind)} />
    </div>
  );

  const expense = cats.filter((c) => c.kind === 'expense' && !c.archived);
  return (
    <Glass style={{ borderRadius: 24, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, color: '#FFFFFF' }}>
      <div style={heading}>{t('settings.categories')}</div>
      {group('expense', t('settings.expenseCats'), t('settings.addCategory'), t('settings.addCategoryBtn'))}
      {group('income', t('settings.incomeChannels'), t('settings.addChannel'), t('settings.addChannelBtn'))}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={sub}>{t('settings.suppliers')}</div>
        {sups.map((s) => (
          <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={row}>
              <NameField value={s.name} label={t('settings.renameSupplier', { name: s.name })} onSave={(name) => void saveSup(s, { name })} />
              {delBtn(s.id, s.name)}
            </div>
            {asking === s.id && <DeletePanel name={s.name} uses={uses.get(s.id) ?? 0} canArchive={false}
              onYes={() => void delSup(s)} onClose={() => setAsking(null)} />}
            <select className="field" aria-label={t('settings.defaultCat', { name: s.name })} value={s.defaultCategoryId ?? ''}
              style={{ ...input, flex: 'none', font: '500 13px Inter, sans-serif' }}
              onChange={(e) => void saveSup(s, { defaultCategoryId: e.target.value || undefined })}>
              <option value="">{t('settings.noDefault')}</option>
              {expense.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              {s.defaultCategoryId && !expense.some((c) => c.id === s.defaultCategoryId) && (
                <option value={s.defaultCategoryId}>{cats.find((c) => c.id === s.defaultCategoryId)?.name ?? ''}</option>
              )}
            </select>
          </div>
        ))}
        <AddRow label={t('settings.addSupplier')} btn={t('settings.addSupplierBtn')} onAdd={addSup} />
      </div>
      {err && <div role="alert" style={{ fontSize: 13, color: '#FF8E8E' }}>{t('settings.saveError')}</div>}
    </Glass>
  );
}
