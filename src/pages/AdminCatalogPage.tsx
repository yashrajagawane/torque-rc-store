import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

interface CatalogItem { id: number; name: string; slug: string; description: string | null; image?: string | null; logo?: string | null; }
type Kind = 'categories' | 'brands';

export function AdminCatalogPage() {
  const { session } = useAuth();
  const [kind, setKind] = useState<Kind>('categories');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [form, setForm] = useState({ name: '', slug: '', description: '', image: '' });
  const [editing, setEditing] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!session?.access_token) throw new Error('Your session expired. Sign in again.');
    const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${session.access_token}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...init, headers }); const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Catalog request failed.'); return payload;
  }, [session?.access_token]);
  const load = useCallback(async () => { setLoading(true); setError(''); try { setItems(await request(`/api/admin/catalog/${kind}`)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Catalog is unavailable.'); } finally { setLoading(false); } }, [kind, request]);
  useEffect(() => { void load(); }, [load]);
  function edit(item: CatalogItem) { setEditing(item.id); setForm({ name: item.name, slug: item.slug, description: item.description || '', image: item.image || item.logo || '' }); setNotice(''); }
  function reset() { setEditing(null); setForm({ name: '', slug: '', description: '', image: '' }); }
  async function save(event: FormEvent) { event.preventDefault(); setSaving(true); setError(''); setNotice(''); try { await request(editing ? `/api/admin/catalog/${kind}/${editing}` : `/api/admin/catalog/${kind}`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(form) }); setNotice(`${kind === 'categories' ? 'Category' : 'Brand'} saved.`); reset(); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save catalog item.'); } finally { setSaving(false); } }
  const field = 'mt-2 w-full bg-[#111] border border-white/10 rounded-sm p-3 text-sm text-white focus:border-accent outline-none';
  return <main className="pt-32 pb-24 min-h-screen"><div className="container px-4 md:px-6 max-w-6xl">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 mb-8 border-b border-white/10 pb-6"><div><p className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] mb-2">Owner Console</p><h1 className="text-3xl md:text-4xl italic">CATALOG CONTROL</h1><p className="text-sm text-muted-foreground mt-2">Manage the categories and brands available to products.</p></div><Link to="/admin/products" className="btn-secondary px-4 py-3 text-xs">PRODUCTS</Link></div>
    <nav aria-label="Admin sections" className="flex flex-wrap gap-5 mb-6 text-xs font-bold uppercase tracking-widest"><Link to="/admin" className="text-muted-foreground hover:text-white">Overview</Link><Link to="/admin/products" className="text-muted-foreground hover:text-white">Products</Link><span className="text-accent">Catalog</span><Link to="/admin/inventory" className="text-muted-foreground hover:text-white">Inventory</Link></nav>
    {error && <p role="alert" className="mb-4 border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">{error}</p>}{notice && <p role="status" className="mb-4 border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-300">{notice}</p>}
    <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6"><form onSubmit={save} className="glass-card p-5 border border-white/5"><div className="flex gap-2 mb-5"><button type="button" onClick={() => { setKind('categories'); reset(); }} className={kind === 'categories' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}>CATEGORIES</button><button type="button" onClick={() => { setKind('brands'); reset(); }} className={kind === 'brands' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}>BRANDS</button></div><h2 className="text-lg font-bold uppercase italic">{editing ? 'Edit item' : `Add ${kind === 'categories' ? 'category' : 'brand'}`}</h2><label className="block mt-5 text-xs uppercase tracking-wider text-muted-foreground">Name<input required maxLength={100} value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value, slug: editing ? v.slug : e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }))} className={field} /></label><label className="block mt-4 text-xs uppercase tracking-wider text-muted-foreground">Slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={120} value={form.slug} onChange={(e) => setForm((v) => ({ ...v, slug: e.target.value }))} className={field} /></label><label className="block mt-4 text-xs uppercase tracking-wider text-muted-foreground">Description<textarea maxLength={2000} rows={4} value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} className={field} /></label><label className="block mt-4 text-xs uppercase tracking-wider text-muted-foreground">{kind === 'categories' ? 'Image URL' : 'Logo URL'}<input maxLength={2048} value={form.image} onChange={(e) => setForm((v) => ({ ...v, image: e.target.value }))} className={field} /></label><div className="flex justify-end gap-2 mt-5"><button type="button" onClick={reset} className="btn-secondary px-4 py-2 text-xs">CLEAR</button><button disabled={saving} className="btn-primary px-4 py-2 text-xs">{saving ? 'SAVING…' : 'SAVE'}</button></div></form><section className="glass-card border border-white/5 overflow-hidden"><div className="p-5 border-b border-white/5"><h2 className="text-lg font-bold uppercase italic">Existing {kind}</h2></div>{loading ? <p className="p-8 text-center text-muted-foreground">Loading…</p> : <div className="divide-y divide-white/5">{items.map((item) => <div key={item.id} className="p-4 flex items-center justify-between gap-4"><div><p className="font-bold">{item.name}</p><p className="text-xs text-muted-foreground">/{item.slug}</p></div><button onClick={() => edit(item)} className="btn-secondary px-3 py-2 text-xs">EDIT</button></div>)}{!items.length && <p className="p-8 text-center text-muted-foreground">No items yet.</p>}</div>}</section></div>
  </div></main>;
}
