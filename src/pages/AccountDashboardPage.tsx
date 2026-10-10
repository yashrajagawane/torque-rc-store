import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Package, Shield, UserRound } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '../auth/AuthContext';
import { signOutCurrentSession } from '../auth/signOut';
import { supabase } from '../lib/supabase';
import { useVisibleCart } from '../cart/useVisibleCart';
import { formatOrderCurrency } from '../lib/order-format';

interface AccountInfo {
  id: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  owner: boolean;
}
interface CustomerOrder {
  id: number;
  total: string;
  currency: string;
  paymentStatus: string | null;
  fulfillmentStatus: string;
  createdAt: string | null;
  items: Array<{ productName: string; quantity: number; price: string }>;
}

function displayName(user: User) {
  const value = user.user_metadata?.display_name;
  return typeof value === 'string' && value.trim() ? value.trim() : user.email || 'Fly RC Hobbies customer';
}

export const AccountDashboardPage = () => {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { items: cartItems } = useVisibleCart();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [accountError, setAccountError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [ordersOwnerId, setOrdersOwnerId] = useState<string | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadAccount() {
      const { data } = await supabase!.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        if (active) setAccountError('Your session expired. Sign in again to continue.');
        return;
      }
      try {
        const response = await fetch('/api/account/me', { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 401) {
          await supabase!.auth.signOut({ scope: 'local' }).catch(() => undefined);
          if (active) navigate('/login', { replace: true });
          return;
        }
        if (!response.ok) throw new Error(payload.error || 'Account information is temporarily unavailable.');
        if (active) setAccount(payload as AccountInfo);
      } catch (cause) {
        if (active) setAccountError(cause instanceof Error ? cause.message : 'Account information is temporarily unavailable.');
      }
    }
    void loadAccount();
    return () => { active = false; };
  }, [user?.id, navigate]);

  useEffect(() => {
    let active = true;
    setOrdersLoading(true);
    setOrdersError('');
    if (!session?.access_token) {
      setOrdersError('Your session expired. Sign in again to view your orders.');
      setOrdersOwnerId(user?.id || null);
      setOrdersLoading(false);
      return;
    }
    fetch('/api/orders/mine', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Order history is temporarily unavailable.');
        if (active) {
          setOrders(Array.isArray(payload.orders) ? payload.orders as CustomerOrder[] : []);
          setOrdersOwnerId(user?.id || null);
        }
      })
      .catch((cause) => {
        if (active) {
          setOrdersError(cause instanceof Error ? cause.message : 'Order history is temporarily unavailable.');
          setOrdersOwnerId(user?.id || null);
        }
      })
      .finally(() => { if (active) setOrdersLoading(false); });
    return () => { active = false; };
  }, [session?.access_token, user?.id]);

  const visibleOrders = ordersOwnerId === user?.id ? orders : [];
  const visibleOrdersLoading = ordersOwnerId !== user?.id || ordersLoading;

  async function signOut() {
    if (!supabase) return;
    setSigningOut(true);
    const { error } = await signOutCurrentSession(supabase);
    setSigningOut(false);
    if (error) {
      setAccountError(error instanceof Error ? error.message : 'Could not sign out. Please try again.');
      return;
    }
    navigate('/login', { replace: true });
  }

  return (
    <div className="pt-32 pb-24 min-h-screen">
      <div className="container px-4 md:px-6 max-w-5xl">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 pb-8 border-b border-white/10 mb-10">
          <div>
            <p className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] mb-2">Customer Account</p>
            <h1 className="text-3xl md:text-4xl italic">PILOT GARAGE</h1>
          </div>
          <button onClick={signOut} disabled={signingOut} className="btn-secondary px-5 py-3 text-xs disabled:opacity-50">
            <span className="skew-x-[10deg] flex items-center gap-2"><LogOut size={15} />{signingOut ? 'SIGNING OUT…' : 'SIGN OUT'}</span>
          </button>
        </div>

        {accountError && <p role="alert" className="glass-card p-4 border border-red-500/30 text-red-300 text-sm mb-6">{accountError}</p>}

        <div className="grid md:grid-cols-3 gap-6">
          <section className="glass-card p-6 border border-white/5 md:col-span-2">
            <div className="flex items-center gap-4 pb-6 border-b border-white/5">
              <div className="w-14 h-14 bg-accent/10 border border-accent/30 flex items-center justify-center text-accent"><UserRound size={25} /></div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold uppercase italic truncate">{account?.displayName || displayName(user!)}</h2>
                <p className="text-sm text-muted-foreground break-all">{account?.email || user?.email}</p>
              </div>
            </div>
            <div className="pt-5 flex flex-wrap items-center gap-3 text-xs">
              <span className="px-3 py-2 bg-white/5 border border-white/10 text-muted-foreground uppercase tracking-wider">Customer account</span>
              <span className={`px-3 py-2 border uppercase tracking-wider ${account?.emailVerified ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
                {account?.emailVerified ? 'Email verified' : 'Email verification pending'}
              </span>
              {account?.owner && <span className="px-3 py-2 bg-accent/10 border border-accent/30 text-accent uppercase tracking-wider">Owner access</span>}
            </div>
          </section>

          <section className="glass-card p-6 border border-white/5">
            <div className="flex items-center gap-3 mb-4"><Package className="text-accent" /><h2 className="text-sm font-bold uppercase italic">Order history</h2></div>
            {visibleOrdersLoading ? <p role="status" className="text-sm text-muted-foreground">Loading your orders…</p> : ordersError ? <p role="alert" className="text-sm text-red-300">{ordersError}</p> : visibleOrders.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : <div className="space-y-4">
              {visibleOrders.map((order) => <article key={order.id} className="border-t border-white/10 pt-4">
                <div className="flex flex-wrap justify-between gap-2"><strong className="text-xs uppercase">Order #{order.id}</strong><span className="text-xs text-muted-foreground">{order.createdAt ? new Date(order.createdAt).toLocaleDateString() : ''}</span></div>
                <p className="mt-2 text-xs text-muted-foreground">Payment: {order.paymentStatus || 'UNPAID'} · Fulfillment: {order.fulfillmentStatus}</p>
                <ul className="mt-2 space-y-1">{order.items.map((item, index) => <li key={`${order.id}-${index}`} className="text-xs text-muted-foreground">{item.productName} × {item.quantity} · {formatOrderCurrency(Number(item.price) * item.quantity)}</li>)}</ul>
                <p className="mt-2 text-sm font-bold">Total {formatOrderCurrency(order.total)}</p>
              </article>)}
            </div>}
          </section>

          <section className="glass-card p-6 border border-white/5">
            <div className="flex items-center gap-3 mb-3"><Shield className="text-accent" /><h2 className="text-sm font-bold uppercase italic">Account security</h2></div>
            <p className="text-xs leading-relaxed text-muted-foreground">Your account is authenticated with Supabase. Keep your password private and sign out on shared devices.</p>
            <Link to="/forgot-password" className="inline-block text-xs text-accent mt-4 hover:underline">Reset password</Link>
          </section>

          <section className="glass-card p-6 border border-white/5">
            <h2 className="text-sm font-bold uppercase italic mb-3">Shopping garage</h2>
            <p className="text-sm text-muted-foreground mb-4">{cartItems.length} item{cartItems.length === 1 ? '' : 's'} currently in your cart.</p>
            <Link to="/collections/all-rc-models" className="text-xs text-accent hover:underline">Browse the collection →</Link>
          </section>
        </div>
      </div>
    </div>
  );
};
