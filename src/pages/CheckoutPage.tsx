import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useVisibleCart } from '../cart/useVisibleCart';
import { formatOrderCurrency } from '../lib/order-format';
import { useCartStore, type CartItem } from '../store/cartStore';

interface CheckoutAddress {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: 'India';
}
interface CheckoutPayload { items: Array<{ productId: number; quantity: number }>; shippingAddress: CheckoutAddress }
interface PendingCheckout { key: string; payload: CheckoutPayload }
interface Preview { items: CartItem[]; subtotal: string; shipping: string; total: string; currency: string }
interface OrderResult { order: { id: number; total: string; paymentStatus: string; fulfillmentStatus: string }; replayed: boolean }

const blankAddress: CheckoutAddress = { fullName: '', phone: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', country: 'India' };
const pendingKeyPrefix = 'rc-mega-checkout-pending:';

function parsePending(value: string | null): PendingCheckout | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as PendingCheckout;
    if (!parsed || typeof parsed.key !== 'string' || !parsed.payload || !Array.isArray(parsed.payload.items) || !parsed.payload.shippingAddress) return null;
    return parsed;
  } catch { return null; }
}

export function CheckoutPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const token = session?.access_token;
  const { visibility } = useVisibleCart();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [address, setAddress] = useState(blankAddress);
  const [pending, setPending] = useState<PendingCheckout | null>(null);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [invalidPending, setInvalidPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);

  const loadPreview = useCallback(async (active: () => boolean) => {
    if (!token) { setLoadingPreview(false); return; }
    try {
      const response = await fetch('/api/orders/checkout-preview', { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not load current cart prices.');
      if (active()) setPreview(payload as Preview);
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : 'Checkout preview is temporarily unavailable.');
    } finally { if (active()) setLoadingPreview(false); }
  }, [token]);

  useEffect(() => {
    let active = true;
    setLoadingPreview(true);
    setPreview(null);
    setError('');
    setOrderResult(null);
    setAddress(blankAddress);
    setPending(null);
    setInvalidPending(false);
    setPendingLoaded(false);
    if (userId) {
      try {
        const raw = localStorage.getItem(`${pendingKeyPrefix}${userId}`);
        const saved = parsePending(raw);
        if (raw && !saved) setInvalidPending(true);
        if (saved) {
          setPending(saved);
          setAddress(saved.payload.shippingAddress);
        }
      } catch { setError('Browser storage is unavailable. Checkout is paused so a retry key can be saved safely.'); }
      setPendingLoaded(true);
    }
    void loadPreview(() => active);
    return () => { active = false; };
  }, [userId, loadPreview]);

  const sendCheckout = async (operation: PendingCheckout) => {
    if (!token || !userId) { setError('Your session expired. Sign in again before retrying checkout.'); return; }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': operation.key },
        body: JSON.stringify(operation.payload),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Order could not be created. Retry the saved request.');
      const result = payload as OrderResult;
      setOrderResult(result);
      try { localStorage.removeItem(`${pendingKeyPrefix}${userId}`); } catch { /* The confirmed order is still displayed; a stale key safely replays the same order. */ }
      setPending(null);
      useCartStore.getState().clearCart();
      setPreview({ items: [], subtotal: '0.00', shipping: '0.00', total: '0.00', currency: 'INR' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Network error. Your saved checkout request is available to retry.');
    } finally { setSaving(false); }
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) { await sendCheckout(pending); return; }
    if (!userId || !preview || preview.items.length === 0) return;
    if (visibility !== 'customer') { setError('Your saved cart ownership is still being confirmed. Wait a moment and retry.'); return; }
    const form = new FormData(event.currentTarget);
    const payload: CheckoutPayload = {
      items: preview.items.map((item) => ({ productId: item.id, quantity: item.quantity })),
      shippingAddress: {
        fullName: String(form.get('fullName') || '').trim(), phone: String(form.get('phone') || '').trim(),
        addressLine1: String(form.get('addressLine1') || '').trim(), addressLine2: String(form.get('addressLine2') || '').trim(),
        city: String(form.get('city') || '').trim(), state: String(form.get('state') || '').trim(),
        postalCode: String(form.get('postalCode') || '').trim(), country: 'India',
      },
    };
    const operation: PendingCheckout = { key: crypto.randomUUID(), payload };
    try {
      localStorage.setItem(`${pendingKeyPrefix}${userId}`, JSON.stringify(operation));
    } catch {
      setError('Browser storage is unavailable. Checkout was not submitted because safe retry protection could not be saved.');
      return;
    }
    setPending(operation);
    await sendCheckout(operation);
  }

  const fieldClass = 'mt-2 w-full bg-[#111] border border-white/10 p-3 text-white outline-none focus:border-accent';
  const unavailableItems = Boolean(preview?.items.some((item) => !item.isPublished || item.availability !== 'IN_STOCK' || !Number.isInteger(item.stock) || (item.stock ?? 0) < item.quantity));
  const canSubmit = !loadingPreview && visibility === 'customer' && Boolean(preview?.items.length) && !unavailableItems && !saving;

  return <main className="pt-32 pb-24 min-h-screen">
    <div className="container px-4 md:px-6 max-w-6xl">
      <p className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] mb-2">Secure Checkout</p>
      <h1 className="text-3xl md:text-4xl italic mb-8">DELIVERY DETAILS</h1>
      {orderResult ? <section className="glass-card border border-emerald-500/30 p-8" role="status">
        <h2 className="text-xl font-bold uppercase italic text-emerald-300">Order #{orderResult.order.id} created</h2>
        <p className="mt-3 text-sm text-muted-foreground">Payment is pending. No payment was taken or marked as paid.</p>
        <p className="mt-2 text-sm">Order total: {formatOrderCurrency(orderResult.order.total)} · {orderResult.order.paymentStatus}</p>
        <Link className="inline-block mt-5 text-accent hover:underline" to="/account">View your account orders →</Link>
      </section> : <div className="grid lg:grid-cols-[1.2fr_.8fr] gap-8">
        <section className="glass-card border border-white/5 p-5 md:p-7">
          {error && <p role="alert" className="mb-5 border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">{error}</p>}
          {visibility === 'loading' && <p role="status" className="mb-5 border border-white/10 p-3 text-sm text-muted-foreground">Confirming cart ownership before checkout…</p>}
          {visibility === 'recovery' && <p role="alert" className="mb-5 border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">Your cart needs recovery before an order can be placed. Your saved items have not been changed.</p>}
          {unavailableItems && <p role="alert" className="mb-5 border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">A product is unpublished, unavailable, or exceeds current stock. Update your cart before placing an order.</p>}
          {invalidPending && <p role="alert" className="mb-5 border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">A saved checkout request could not be read. It has not been replaced. Contact store support before clearing browser data.</p>}
          {pending && <div className="mb-5 border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100">
            <p>This checkout has a saved retry key. Every retry will use the same order details and key. Do not start a second checkout until this request is resolved.</p>
          </div>}
          {loadingPreview ? <p role="status" className="py-10 text-center text-muted-foreground">Loading your current cart and prices…</p> : pendingLoaded && !pending && !invalidPending && !preview?.items.length ? <div className="py-10 text-center">
            <p className="text-muted-foreground">Your saved cart is empty.</p><Link to="/collections/all-rc-models" className="inline-block mt-4 text-accent hover:underline">Continue shopping →</Link>
          </div> : <form onSubmit={(event) => void submit(event)} className="grid sm:grid-cols-2 gap-5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground sm:col-span-2">Delivery name
              <input name="fullName" autoComplete="name" required minLength={2} maxLength={100} disabled={Boolean(pending)} value={address.fullName} onChange={(e) => setAddress((v) => ({ ...v, fullName: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground sm:col-span-2">Phone number
              <input name="phone" type="tel" autoComplete="tel" required minLength={7} maxLength={20} disabled={Boolean(pending)} value={address.phone} onChange={(e) => setAddress((v) => ({ ...v, phone: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground sm:col-span-2">Address line 1
              <input name="addressLine1" autoComplete="address-line1" required minLength={3} maxLength={200} disabled={Boolean(pending)} value={address.addressLine1} onChange={(e) => setAddress((v) => ({ ...v, addressLine1: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground sm:col-span-2">Address line 2
              <input name="addressLine2" autoComplete="address-line2" maxLength={200} disabled={Boolean(pending)} value={address.addressLine2} onChange={(e) => setAddress((v) => ({ ...v, addressLine2: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">City
              <input name="city" autoComplete="address-level2" required minLength={2} maxLength={100} disabled={Boolean(pending)} value={address.city} onChange={(e) => setAddress((v) => ({ ...v, city: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">State
              <input name="state" autoComplete="address-level1" required minLength={2} maxLength={100} disabled={Boolean(pending)} value={address.state} onChange={(e) => setAddress((v) => ({ ...v, state: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground sm:col-span-2">Postal code
              <input name="postalCode" autoComplete="postal-code" required minLength={3} maxLength={15} disabled={Boolean(pending)} value={address.postalCode} onChange={(e) => setAddress((v) => ({ ...v, postalCode: e.target.value }))} className={fieldClass} />
            </label>
            <button disabled={saving || invalidPending || (!pending && !canSubmit)} className="btn-primary sm:col-span-2 py-4 disabled:opacity-50">
              <span className="skew-x-[10deg]">{saving ? 'SAVING ORDER…' : pending ? 'RETRY SAVED CHECKOUT' : 'PLACE ORDER · PAYMENT PENDING'}</span>
            </button>
          </form>}
        </section>

        <aside className="glass-card border border-white/5 p-5 md:p-7 h-fit">
          <h2 className="text-lg font-bold uppercase italic mb-5">Order Summary</h2>
          {loadingPreview ? <p role="status" className="text-sm text-muted-foreground">Fetching current prices…</p> : <>
            <div className="divide-y divide-white/5">{preview?.items.map((item) => <div key={item.id} className="py-4 flex gap-4">
              <img src={item.thumbnail} alt="" className="h-16 w-16 object-contain bg-black/40 p-2" />
              <div className="min-w-0 flex-1"><p className="text-sm font-bold uppercase truncate">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">Qty {item.quantity} × {formatOrderCurrency(item.price)}</p>
                {(!item.isPublished || item.availability !== 'IN_STOCK' || !item.stock || item.quantity > item.stock) && <p className="mt-1 text-xs text-red-300">Unavailable or stock changed. Update your cart before ordering.</p>}
              </div><span className="text-sm font-bold">{formatOrderCurrency(Number(item.price) * item.quantity)}</span>
            </div>)}</div>
            <div className="border-t border-white/10 mt-3 pt-4 space-y-3 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatOrderCurrency(preview?.subtotal || '0.00')}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span>{Number(preview?.shipping || 0) ? formatOrderCurrency(preview?.shipping || '0.00') : 'Free'}</span></div><div className="flex justify-between border-t border-white/10 pt-4 text-base font-black"><span>Total</span><span>{formatOrderCurrency(preview?.total || '0.00')}</span></div></div>
            <p className="mt-5 text-xs text-amber-200">A pending order reserves its items for 20 minutes. It remains unpaid until a verified payment integration confirms payment.</p>
          </>}
        </aside>
      </div>}
    </div>
  </main>;
}
