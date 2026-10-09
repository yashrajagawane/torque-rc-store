import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { formatOrderCurrency } from '../lib/order-format';

interface OrderItem { productId: number | null; productName: string; productSlug: string; quantity: number; price: string }
interface ShippingAddress { fullName: string; phone: string; addressLine1: string; addressLine2?: string; city: string; state: string; postalCode: string; country: string }
interface ManagedOrder {
  id: number;
  customerEmail: string | null;
  subtotal: string;
  shippingAmount: string;
  total: string;
  currency: string;
  status: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string;
  shippingAddress: ShippingAddress;
  createdAt: string | null;
  items: OrderItem[];
}
interface PaymentReviewCase {
  id: number;
  orderId: number | null;
  customerEmail: string | null;
  orderTotal: string | null;
  paymentId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  reason: string;
  createdAt: string;
}

function nextStatuses(order: ManagedOrder) {
  if (order.fulfillmentStatus === 'CANCELLED' || order.fulfillmentStatus === 'DELIVERED') return [];
  const statuses = order.paymentStatus === 'PAID'
    ? order.fulfillmentStatus === 'UNFULFILLED' ? ['PROCESSING', 'CANCELLED']
      : order.fulfillmentStatus === 'PROCESSING' ? ['SHIPPED', 'CANCELLED']
        : order.fulfillmentStatus === 'SHIPPED' ? ['DELIVERED', 'CANCELLED'] : []
    : ['CANCELLED'];
  return statuses;
}

export function AdminOrdersPage() {
  const { session } = useAuth();
  const [orders, setOrders] = useState<ManagedOrder[]>([]);
  const [reviewCases, setReviewCases] = useState<PaymentReviewCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!session?.access_token) throw new Error('Your session expired. Sign in again.');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${session.access_token}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...init, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Order request failed.');
    return payload;
  }, [session?.access_token]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [payload, reviewPayload] = await Promise.all([
        request('/api/admin/orders'), request('/api/admin/payment-review-cases'),
      ]);
      setOrders(Array.isArray(payload.orders) ? payload.orders as ManagedOrder[] : []);
      setReviewCases(Array.isArray(reviewPayload.cases) ? reviewPayload.cases as PaymentReviewCase[] : []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Order management is unavailable.'); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { void loadOrders(); }, [loadOrders]);

  async function updateStatus(order: ManagedOrder, status: string) {
    setBusyId(order.id);
    setError('');
    setNotice('');
    try {
      await request(`/api/admin/orders/${order.id}/fulfillment`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setNotice(`Order #${order.id} fulfillment updated to ${status}.`);
      await loadOrders();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Order status could not be updated.'); }
    finally { setBusyId(null); }
  }

  return <main className="pt-32 pb-24 min-h-screen">
    <div className="container px-4 md:px-6 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 mb-8 border-b border-white/10 pb-6">
        <div><p className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] mb-2">Owner Console</p><h1 className="text-3xl md:text-4xl italic">ORDER MANAGEMENT</h1></div>
        <Link to="/admin" className="btn-secondary px-4 py-3 text-xs">PRODUCTS</Link>
      </div>
      <div className="flex gap-5 mb-6 text-xs font-bold uppercase tracking-widest"><Link to="/admin" className="text-muted-foreground hover:text-white">Products</Link><span className="text-accent">Orders</span></div>
      {error && <p role="alert" className="mb-5 border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="mb-5 border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-300">{notice}</p>}
      {reviewCases.length > 0 && <section className="glass-card mb-6 border border-amber-500/30 p-5" aria-labelledby="payment-review-heading">
        <h2 id="payment-review-heading" className="text-lg font-bold uppercase italic text-amber-200">Captured payments needing review</h2>
        <p className="mt-2 text-xs text-amber-100">These payments were not marked paid and inventory was not consumed. Reconcile with Razorpay and handle any refund manually; automatic refunds are not configured.</p>
        <div className="mt-4 space-y-3">{reviewCases.map((item) => <article key={item.id} className="border border-white/10 p-4 text-sm">
          <p className="font-bold">{item.orderId ? `Order #${item.orderId}` : 'Unmatched Razorpay order'} · {item.paymentId}</p>
          <p className="mt-1 text-xs text-muted-foreground">Razorpay order {item.razorpayOrderId} · {formatOrderCurrency(item.amountPaise / 100)} {item.currency} · {item.customerEmail || 'Customer not matched'}</p>
          <p className="mt-2 text-amber-100">{item.reason}</p>
        </article>)}</div>
      </section>}
      {loading ? <p role="status" className="glass-card p-10 text-center text-muted-foreground">Loading orders…</p> : orders.length === 0 ? <p className="glass-card p-10 text-center text-muted-foreground">No orders have been placed.</p> : <div className="space-y-5">
        {orders.map((order) => <article key={order.id} className="glass-card border border-white/5 p-5 md:p-6">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
            <div className="min-w-0">
              <h2 className="text-lg font-bold uppercase italic">Order #{order.id}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{order.createdAt ? new Date(order.createdAt).toLocaleString() : 'Date unavailable'} · {order.customerEmail || 'Customer email unavailable'}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase"><span className="border border-white/10 px-2 py-1">Payment: {order.paymentStatus || 'UNPAID'}</span><span className="border border-accent/30 px-2 py-1 text-accent">Fulfillment: {order.fulfillmentStatus}</span></div>
            </div>
            <div className="flex flex-wrap gap-2">{nextStatuses(order).map((status) => <button key={status} disabled={busyId === order.id} onClick={() => void updateStatus(order, status)} className={`btn-secondary px-3 py-2 text-[10px] disabled:opacity-50 ${status === 'CANCELLED' ? 'text-red-300' : ''}`}>{busyId === order.id ? 'SAVING…' : status}</button>)}</div>
          </div>
          <div className="mt-5 grid md:grid-cols-2 gap-6 border-t border-white/5 pt-5">
            <section><h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Delivery</h3><address className="not-italic text-sm leading-6">{order.shippingAddress.fullName}<br />{order.shippingAddress.phone}<br />{order.shippingAddress.addressLine1}{order.shippingAddress.addressLine2 ? `, ${order.shippingAddress.addressLine2}` : ''}<br />{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}<br />{order.shippingAddress.country}</address></section>
            <section><h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Items</h3><ul className="space-y-2">{order.items.map((item, index) => <li key={`${order.id}-${index}`} className="flex justify-between gap-4 text-sm"><span>{item.productName} × {item.quantity}</span><span>{formatOrderCurrency(Number(item.price) * item.quantity)}</span></li>)}</ul>
              <div className="mt-4 border-t border-white/10 pt-3 space-y-1 text-xs"><p className="flex justify-between"><span>Subtotal</span><span>{formatOrderCurrency(order.subtotal)}</span></p><p className="flex justify-between"><span>Shipping</span><span>{formatOrderCurrency(order.shippingAmount)}</span></p><p className="flex justify-between text-sm font-black pt-2"><span>Total</span><span>{formatOrderCurrency(order.total)}</span></p></div>
            </section>
          </div>
          {order.paymentStatus !== 'PAID' && <p className="mt-4 border-t border-amber-500/10 pt-3 text-xs text-amber-200">Payment is not confirmed. Fulfillment transitions are disabled until a verified payment integration marks the order paid.</p>}
        </article>)}
      </div>}
    </div>
  </main>;
}
