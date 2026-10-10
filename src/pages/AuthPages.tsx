import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

type AuthMode = 'login' | 'register' | 'recovery' | 'reset';

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="pt-36 pb-24 min-h-[75vh] px-4">
      <div className="glass-card border border-white/10 bg-[#0a0a0a] max-w-lg mx-auto p-6 sm:p-10">
        <p className="text-accent font-mono text-xs font-bold uppercase tracking-[0.25em] mb-3">FLY RC HOBBIES / PILOT ACCESS</p>
        <h1 className="text-3xl sm:text-4xl italic mb-3">{title}</h1>
        <p className="text-sm text-muted-foreground mb-8">{subtitle}</p>
        {children}
      </div>
    </section>
  );
}

function AuthUnavailable() {
  return <AuthFrame title="AUTH OFFLINE" subtitle="Supabase Auth is not configured for this deployment.">
    <p className="text-sm text-muted-foreground">Set the public Supabase URL and anon key in the frontend environment, then restart the app.</p>
  </AuthFrame>;
}

function useAuthForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  return { busy, setBusy, error, setError, notice, setNotice };
}

function AuthForm({ mode }: { mode: AuthMode }) {
  const auth = useAuthForm();
  const { setBusy, setError, setNotice, busy, error, notice } = auth;
  const navigate = useNavigate();
  const location = useLocation();
  const returnPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/account';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    if (mode !== 'reset' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if ((mode === 'register' || mode === 'reset') && password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        navigate(returnPath, { replace: true });
      } else if (mode === 'register') {
        const displayName = String(form.get('displayName') || '').trim();
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/account`,
          },
        });
        if (authError) throw authError;
        if (!data.session) setNotice('Check your inbox and verify your email before signing in.');
        else navigate('/account', { replace: true });
      } else if (mode === 'recovery') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/account/reset-password`,
        });
        if (authError) throw authError;
        setNotice('If an account exists for that address, a password reset link has been sent.');
      } else {
        if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) throw authError;
        setNotice('Password updated. You can now use your new password.');
        window.setTimeout(() => navigate('/account', { replace: true }), 900);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'login' ? 'PILOT SIGN IN' : mode === 'register' ? 'JOIN THE GARAGE' : mode === 'recovery' ? 'RESET PASSWORD' : 'SET NEW PASSWORD';
  const subtitle = mode === 'login' ? 'Sign in to access your customer account.' : mode === 'register' ? 'Create an account to manage your Fly RC Hobbies profile.' : mode === 'recovery' ? 'We’ll email you a secure password reset link.' : 'Choose a new password for your account.';

  return <AuthFrame title={title} subtitle={subtitle}>
    <form onSubmit={submit} className="space-y-5" noValidate>
      {mode === 'register' && <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Name
        <input name="displayName" autoComplete="name" maxLength={100} className="mt-2 w-full bg-[#111] border border-white/10 p-3 text-white focus:border-accent outline-none" />
      </label>}
      {mode !== 'reset' && <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Email
        <input name="email" type="email" autoComplete="email" required maxLength={254} className="mt-2 w-full bg-[#111] border border-white/10 p-3 text-white focus:border-accent outline-none" />
      </label>}
      {(mode === 'login' || mode === 'register' || mode === 'reset') && <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">{mode === 'reset' ? 'New password' : 'Password'}
        <input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} maxLength={128} className="mt-2 w-full bg-[#111] border border-white/10 p-3 text-white focus:border-accent outline-none" />
      </label>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-400">{notice}</p>}
      <button disabled={busy} className="w-full btn-primary py-4 disabled:opacity-50" type="submit">
        <span className="skew-x-[10deg]">{busy ? 'PLEASE WAIT…' : mode === 'login' ? 'SIGN IN' : mode === 'register' ? 'CREATE ACCOUNT' : mode === 'recovery' ? 'SEND RESET LINK' : 'UPDATE PASSWORD'}</span>
      </button>
    </form>
    <div className="flex flex-wrap gap-x-5 gap-y-3 mt-6 text-xs text-muted-foreground">
      {mode === 'login' && <><Link className="hover:text-white" to="/forgot-password">Forgot password?</Link><Link className="hover:text-white" to="/register">Create account</Link></>}
      {mode === 'register' && <Link className="hover:text-white" to="/login">Already registered? Sign in</Link>}
      {(mode === 'recovery' || mode === 'reset') && <Link className="hover:text-white" to="/login">Back to sign in</Link>}
    </div>
  </AuthFrame>;
}

export function LoginPage() {
  const { user, configured, loading } = useAuth();
  if (!configured) return <AuthUnavailable />;
  if (loading) return <div role="status" className="pt-40 pb-24 container text-center text-muted-foreground">Checking your session…</div>;
  if (user) return <Navigate to="/account" replace />;
  return <AuthForm mode="login" />;
}

export function RegisterPage() {
  const { user, configured, loading } = useAuth();
  if (!configured) return <AuthUnavailable />;
  if (loading) return <div role="status" className="pt-40 pb-24 container text-center text-muted-foreground">Checking your session…</div>;
  if (user) return <Navigate to="/account" replace />;
  return <AuthForm mode="register" />;
}

export function PasswordRecoveryPage() {
  return supabase ? <AuthForm mode="recovery" /> : <AuthUnavailable />;
}

export function PasswordResetPage() {
  const { user, configured, loading } = useAuth();
  if (!configured) return <AuthUnavailable />;
  if (loading) return <div role="status" className="pt-40 pb-24 container text-center text-muted-foreground">Validating reset link…</div>;
  if (!user) return <AuthFrame title="LINK EXPIRED" subtitle="This password reset link is invalid or expired."><Link className="text-accent" to="/forgot-password">Request another reset link</Link></AuthFrame>;
  return <AuthForm mode="reset" />;
}

export function AuthCallbackPage() {
  const { user, configured, loading } = useAuth();
  const location = useLocation();
  const destination = new URLSearchParams(location.search).get('next');
  const next = destination === '/account' ? destination : '/account';
  if (!configured) return <AuthUnavailable />;
  if (loading) return <div role="status" className="pt-40 pb-24 container text-center text-muted-foreground">Verifying your email link…</div>;
  if (user) return <Navigate to={next} replace />;
  return <AuthFrame title="LINK UNAVAILABLE" subtitle="This verification link may have expired or already been used."><Link className="text-accent" to="/login">Return to sign in</Link></AuthFrame>;
}
