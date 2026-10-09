import 'dotenv/config';
import { createClient, type User } from '@supabase/supabase-js';
import type { Request, RequestHandler } from 'express';

export type VerifiedAuthUser = Pick<User, 'id' | 'email' | 'email_confirmed_at' | 'user_metadata'>;
export interface AuthenticatedRequest extends Request {
  authUser?: VerifiedAuthUser;
  isOwner?: boolean;
}
export type TokenVerifier = (accessToken: string) => Promise<VerifiedAuthUser | null>;

export class SupabaseVerificationUnavailableError extends Error {
  constructor() {
    super('Supabase Auth could not verify the access token.');
    this.name = 'SupabaseVerificationUnavailableError';
  }
}

let serverClient: ReturnType<typeof createClient> | null | undefined;

function getServerClient() {
  if (serverClient !== undefined) return serverClient;
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    serverClient = null;
    return serverClient;
  }
  try {
    serverClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  } catch (error) {
    console.error('Supabase server auth configuration is invalid.');
    serverClient = null;
  }
  return serverClient;
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] || null;
}

async function verifySupabaseAccessToken(token: string): Promise<VerifiedAuthUser | null> {
  const client = getServerClient();
  if (!client) throw new Error('Supabase auth is not configured.');
  const { data, error } = await client.auth.getUser(token);
  return interpretSupabaseUserResponse(data.user, error);
}

export function interpretSupabaseUserResponse(
  user: VerifiedAuthUser | null,
  error: unknown,
): VerifiedAuthUser | null {
  if (!error) return user;
  const details = error as { status?: unknown; code?: unknown; name?: unknown };
  const status = typeof details.status === 'number' ? details.status : undefined;
  const code = typeof details.code === 'string' ? details.code.toLowerCase() : '';
  const name = typeof details.name === 'string' ? details.name : '';
  const invalidTokenCodes = new Set([
    'bad_jwt',
    'invalid_jwt',
    'invalid_token',
    'no_authorization',
    'session_expired',
    'session_not_found',
    'user_not_found',
  ]);

  if (status === 401 || invalidTokenCodes.has(code)) return null;
  // Unknown errors fail closed as service errors instead of falsely blaming the user's token.
  if (status === 429 || (status !== undefined && status >= 500) || name === 'AuthRetryableFetchError') {
    throw new SupabaseVerificationUnavailableError();
  }
  throw new SupabaseVerificationUnavailableError();
}

export function createRequireAuth(verifyToken: TokenVerifier = verifySupabaseAccessToken): RequestHandler {
  return async (req, res, next) => {
    const token = extractBearerToken(req.header('authorization'));
    if (!token) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    try {
      const user = await verifyToken(token);
      if (!user) {
        res.status(401).json({ error: 'Invalid or expired access token.' });
        return;
      }
      (req as AuthenticatedRequest).authUser = user;
      next();
    } catch {
      res.status(503).json({ error: 'Authentication service is temporarily unavailable.' });
    }
  };
}

export function isOwnerEmail(email: string | null | undefined, emailConfirmedAt: string | null | undefined, allowlist: string): boolean {
  if (!email || !emailConfirmedAt) return false;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;
  const allowedEmails = new Set(allowlist.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  return allowedEmails.has(normalizedEmail);
}

export function createRequireOwner(allowlist: () => string = () => process.env.ADMIN_EMAILS || ''): RequestHandler {
  return (req, res, next) => {
    const user = (req as AuthenticatedRequest).authUser;
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!isOwnerEmail(user.email, user.email_confirmed_at, allowlist())) {
      res.status(403).json({ error: 'Owner access required.' });
      return;
    }
    (req as AuthenticatedRequest).isOwner = true;
    next();
  };
}

export const requireAuth = createRequireAuth();
export const requireOwner = createRequireOwner();
