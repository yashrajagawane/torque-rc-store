import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

interface ContactInquiry {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  inquiryType: string;
  model: string | null;
  message: string;
  status: string;
  createdAt: string;
}

export function AdminContactInquiriesPage() {
  const { session } = useAuth();
  const [inquiries, setInquiries] = useState<ContactInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadInquiries = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!session?.access_token) throw new Error('Your session expired. Sign in again.');
      const response = await fetch('/api/admin/contact-inquiries', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'The inquiry inbox is unavailable.');
      setInquiries(Array.isArray(payload.inquiries) ? payload.inquiries : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The inquiry inbox is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => { void loadInquiries(); }, [loadInquiries]);

  return <main className="pt-32 pb-24 min-h-screen">
    <div className="container px-4 md:px-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 mb-8 border-b border-white/10 pb-6">
        <div><p className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] mb-2">Owner Console</p><h1 className="text-3xl md:text-4xl italic">CUSTOMER INQUIRIES</h1></div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin" className="btn-secondary px-4 py-3 text-xs">PRODUCTS</Link>
          <Link to="/admin/orders" className="btn-secondary px-4 py-3 text-xs">ORDERS</Link>
        </div>
      </div>
      <nav aria-label="Admin sections" className="flex flex-wrap gap-5 mb-6 text-xs font-bold uppercase tracking-widest">
        <Link to="/admin" className="text-muted-foreground hover:text-white">Products</Link>
        <Link to="/admin/orders" className="text-muted-foreground hover:text-white">Orders</Link>
        <span className="text-accent">Inquiries</span>
      </nav>
      <p className="mb-5 text-xs text-muted-foreground">Latest 100 saved submissions. No automatic email reply is configured.</p>
      {error && <p role="alert" className="mb-5 border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">{error}</p>}
      {loading ? <p role="status" className="glass-card p-10 text-center text-muted-foreground">Loading inquiries…</p>
        : inquiries.length === 0 ? <p className="glass-card p-10 text-center text-muted-foreground">No saved inquiries yet.</p>
          : <div className="space-y-4">{inquiries.map((inquiry) => <article key={inquiry.id} className="glass-card border border-white/5 p-5 md:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-white/5 pb-4">
              <div className="min-w-0"><h2 className="text-lg font-bold">{inquiry.name}</h2><p className="mt-1 break-all text-sm text-accent">{inquiry.email}</p>{inquiry.phone && <p className="mt-1 text-sm text-muted-foreground">{inquiry.phone}</p>}</div>
              <div className="sm:text-right"><span className="inline-block border border-accent/30 px-2 py-1 text-[10px] font-bold uppercase text-accent">{inquiry.status}</span><p className="mt-2 text-xs text-muted-foreground">{new Date(inquiry.createdAt).toLocaleString()}</p></div>
            </div>
            <p className="mt-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{inquiry.inquiryType}{inquiry.model ? ` · ${inquiry.model}` : ''}</p>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/90">{inquiry.message}</p>
          </article>)}</div>}
    </div>
  </main>;
}
