import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ClipboardList, FileEdit, IndianRupee, Package, RefreshCw, ShoppingCart, Truck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

interface Summary {
  todayOrders: number;
  todayRevenue: string;
  pendingPayments: number;
  awaitingShipment: number;
  lowStockProducts: number;
  draftProducts: number;
  newInquiries: number;
  paymentReviewCases: number;
  lowStockThreshold: number;
  timezone: string;
}

const money = (value: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));

export function AdminDashboardPage() {
  const { session } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/dashboard/summary', { headers: { Authorization: `Bearer ${session.access_token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Dashboard is unavailable.');
      setSummary(payload as Summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dashboard is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => { void load(); }, [load]);

  const cards = summary ? [
    ['Today\'s orders', String(summary.todayOrders), '/admin/orders', ShoppingCart],
    ['Today\'s revenue', money(summary.todayRevenue), '/admin/orders', IndianRupee],
    ['Pending payments', String(summary.pendingPayments), '/admin/orders', ClipboardList],
    ['Waiting to ship', String(summary.awaitingShipment), '/admin/orders', Truck],
    ['Low-stock products', String(summary.lowStockProducts), '/admin/inventory', AlertTriangle],
    ['Draft products', String(summary.draftProducts), '/admin/products?publication=draft', FileEdit],
    ['New inquiries', String(summary.newInquiries), '/admin/inquiries', Users],
    ['Payment review', String(summary.paymentReviewCases), '/admin/orders', AlertTriangle],
  ] as const : [];

  return <main className="pt-32 pb-24 min-h-screen">
    <div className="container px-4 md:px-6 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 mb-8 border-b border-white/10 pb-6">
        <div><p className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] mb-2">Owner Console</p><h1 className="text-3xl md:text-4xl italic">CONTROL ROOM</h1><p className="text-sm text-muted-foreground mt-2">Store performance and action items at a glance.</p></div>
        <button onClick={() => void load()} className="btn-secondary px-4 py-3 text-xs flex items-center gap-2" disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> REFRESH</button>
      </div>
      <nav aria-label="Admin sections" className="flex flex-wrap gap-5 mb-8 text-xs font-bold uppercase tracking-widest"><span className="text-accent">Overview</span><Link to="/admin/products" className="text-muted-foreground hover:text-white">Products</Link><Link to="/admin/orders" className="text-muted-foreground hover:text-white">Orders</Link><Link to="/admin/inventory" className="text-muted-foreground hover:text-white">Inventory</Link><Link to="/admin/inquiries" className="text-muted-foreground hover:text-white">Inquiries</Link></nav>
      {error && <p role="alert" className="mb-5 border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">{error}</p>}
      {loading && !summary ? <p role="status" className="glass-card p-10 text-center text-muted-foreground">Loading owner dashboard…</p> : <>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(([label, value, href, Icon]) => <Link key={label} to={href} className="glass-card p-5 border border-white/5 hover:border-accent/40 transition-colors"><div className="flex items-center justify-between"><span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span><Icon size={18} className="text-accent" /></div><p className="mt-4 text-3xl font-black">{value}</p></Link>)}
        </div>
        <div className="mt-8 grid md:grid-cols-3 gap-4">
          <Link to="/admin/products" className="btn-primary px-5 py-4 text-xs flex items-center justify-center gap-2"><Package size={16} /> MANAGE PRODUCTS</Link>
          <Link to="/admin/inventory" className="btn-secondary px-5 py-4 text-xs flex items-center justify-center gap-2"><AlertTriangle size={16} /> CHECK INVENTORY</Link>
          <Link to="/admin/orders" className="btn-secondary px-5 py-4 text-xs flex items-center justify-center gap-2"><ClipboardList size={16} /> REVIEW ORDERS</Link>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">Revenue and order counts use the {summary?.timezone || 'Asia/Kolkata'} business day. Low stock is currently defined as {summary?.lowStockThreshold ?? 5} units or fewer.</p>
      </>}
    </div>
  </main>;
}
