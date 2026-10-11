import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

interface InventoryProduct { id: number; name: string; slug: string; stock: number | null; reservedStock: number; availableStock: number; lowStock: boolean; isPublished: boolean; }

export function AdminInventoryPage() {
  const { session } = useAuth();
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/admin/dashboard/inventory', { headers: { Authorization: `Bearer ${session.access_token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Inventory is unavailable.');
      setProducts(payload.products || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Inventory is unavailable.'); }
    finally { setLoading(false); }
  }, [session?.access_token]);
  useEffect(() => { void load(); }, [load]);
  return <main className="pt-32 pb-24 min-h-screen"><div className="container px-4 md:px-6 max-w-7xl">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 mb-8 border-b border-white/10 pb-6"><div><p className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] mb-2">Owner Console</p><h1 className="text-3xl md:text-4xl italic">INVENTORY CONTROL</h1><p className="text-sm text-muted-foreground mt-2">Available stock excludes active checkout reservations.</p></div><Link to="/admin/products" className="btn-secondary px-4 py-3 text-xs">PRODUCTS</Link></div>
    <nav aria-label="Admin sections" className="flex flex-wrap gap-5 mb-6 text-xs font-bold uppercase tracking-widest"><Link to="/admin" className="text-muted-foreground hover:text-white">Overview</Link><Link to="/admin/products" className="text-muted-foreground hover:text-white">Products</Link><span className="text-accent">Inventory</span><Link to="/admin/orders" className="text-muted-foreground hover:text-white">Orders</Link></nav>
    {error && <p role="alert" className="mb-5 border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">{error}</p>}
    {loading ? <p role="status" className="glass-card p-10 text-center text-muted-foreground">Loading inventory…</p> : <div className="glass-card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-white/10 text-xs uppercase tracking-widest text-muted-foreground"><tr><th className="p-4">Product</th><th className="p-4">Physical</th><th className="p-4">Reserved</th><th className="p-4">Available</th><th className="p-4">Status</th></tr></thead><tbody>{products.map((product) => <tr key={product.id} className="border-b border-white/5"><td className="p-4 font-bold">{product.name}<span className="block text-xs text-muted-foreground">{product.isPublished ? 'Published' : 'Draft'}</span></td><td className="p-4">{product.stock ?? 0}</td><td className="p-4">{product.reservedStock}</td><td className="p-4 font-bold">{product.availableStock}</td><td className="p-4"><span className={product.lowStock ? 'text-amber-300' : 'text-emerald-300'}>{product.lowStock ? 'LOW STOCK' : 'OK'}</span></td></tr>)}</tbody></table>{products.length === 0 && <p className="p-10 text-center text-muted-foreground">No products found.</p>}</div>}
  </div></main>;
}
