import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth();
  const location = useLocation();

  if (!configured) {
    return <div className="pt-40 pb-24 container text-center text-muted-foreground">Account access is not configured yet.</div>;
  }
  if (loading) {
    return <div role="status" className="pt-40 pb-24 container text-center text-muted-foreground">Checking your session…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
