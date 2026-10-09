import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';

type AccessState = 'checking' | 'owner' | 'forbidden' | 'error';

export function RequireOwner({ children }: { children: ReactNode }) {
  const { user, loading, configured } = useAuth();
  const [access, setAccess] = useState<AccessState>('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (loading || !user || !supabase) return;
    let active = true;
    async function verifyOwner() {
      setAccess('checking');
      try {
        const { data, error } = await supabase!.auth.getSession();
        if (error || !data.session?.access_token) {
          if (active) setAccess('error');
          return;
        }
        const response = await fetch('/api/account/me', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        if (response.status === 401) {
          await supabase!.auth.signOut({ scope: 'local' }).catch(() => undefined);
          if (active) setAccess('error');
          return;
        }
        if (response.status === 403) {
          if (active) setAccess('forbidden');
          return;
        }
        if (!response.ok) throw new Error('Owner access could not be verified. Please try again.');
        const account = await response.json() as { owner?: boolean };
        if (active) setAccess(account.owner === true ? 'owner' : 'forbidden');
      } catch (cause) {
        if (active) {
          setMessage(cause instanceof Error ? cause.message : 'Owner access could not be verified.');
          setAccess('error');
        }
      }
    }
    void verifyOwner();
    return () => { active = false; };
  }, [loading, user?.id, configured]);

  if (!configured) return <div className="pt-40 pb-24 container text-center text-muted-foreground">Supabase Auth is not configured.</div>;
  if (loading) return <div role="status" className="pt-40 pb-24 container text-center text-muted-foreground">Checking your session…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (access === 'checking') return <div role="status" className="pt-40 pb-24 container text-center text-muted-foreground">Verifying owner permissions…</div>;
  if (access === 'forbidden') return <div role="alert" className="pt-40 pb-24 container text-center text-red-300">Owner access is required to view this page.</div>;
  if (access === 'error') return <div role="alert" className="pt-40 pb-24 container text-center text-red-300">{message || 'Could not verify your access. Refresh to try again.'}</div>;
  return <>{children}</>;
}
