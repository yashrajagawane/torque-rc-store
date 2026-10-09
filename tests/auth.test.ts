import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { createRequireAuth, createRequireOwner, extractBearerToken, interpretSupabaseUserResponse, type AuthenticatedRequest, type VerifiedAuthUser } from '../src/server/auth.ts';
import { signOutCurrentSession } from '../src/auth/signOut.ts';

const verifiedUser: VerifiedAuthUser = {
  id: 'auth-user-1',
  email: 'owner@example.com',
  email_confirmed_at: '2026-01-01T00:00:00.000Z',
  user_metadata: {},
};

async function invoke(handler: ReturnType<typeof createRequireAuth> | ReturnType<typeof createRequireOwner>, authorization?: string, authUser?: VerifiedAuthUser) {
  let statusCode = 200;
  let body: unknown;
  let nextCalled = false;
  const req = {
    header: (name: string) => name.toLowerCase() === 'authorization' ? authorization : undefined,
    authUser,
  } as unknown as AuthenticatedRequest;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;

  await handler(req as Request, res, (error?: unknown) => {
    if (error) throw error;
    nextCalled = true;
  });
  return { statusCode, body, nextCalled, req };
}

describe('Supabase auth middleware', () => {
  it('accepts only a well-formed bearer token', () => {
    assert.equal(extractBearerToken('Bearer access-token'), 'access-token');
    assert.equal(extractBearerToken('bearer access-token'), 'access-token');
    assert.equal(extractBearerToken('Basic access-token'), null);
    assert.equal(extractBearerToken('Bearer one two'), null);
    assert.equal(extractBearerToken(undefined), null);
  });

  it('returns 401 when the token is missing or invalid', async () => {
    const auth = createRequireAuth(async (token) => token === 'valid' ? verifiedUser : null);
    assert.equal((await invoke(auth)).statusCode, 401);
    const invalid = await invoke(auth, 'Bearer expired');
    assert.equal(invalid.statusCode, 401);
    assert.equal(invalid.nextCalled, false);
  });

  it('maps Supabase invalid and expired token responses to 401', async () => {
    const invalid = interpretSupabaseUserResponse(null, { status: 400, code: 'invalid_jwt', name: 'AuthInvalidJwtError' });
    const expired = interpretSupabaseUserResponse(null, { status: 401, code: 'session_expired', name: 'AuthApiError' });
    const forbiddenJwt = interpretSupabaseUserResponse(null, { status: 403, code: 'bad_jwt', name: 'AuthApiError' });
    const auth = createRequireAuth(async () => invalid);
    const expiredAuth = createRequireAuth(async () => expired);
    const forbiddenJwtAuth = createRequireAuth(async () => forbiddenJwt);
    assert.equal((await invoke(auth, 'Bearer invalid')).statusCode, 401);
    assert.equal((await invoke(expiredAuth, 'Bearer expired')).statusCode, 401);
    assert.equal((await invoke(forbiddenJwtAuth, 'Bearer invalid')).statusCode, 401);
  });

  it('attaches only the verifier-returned identity to the request', async () => {
    const auth = createRequireAuth(async () => verifiedUser);
    const result = await invoke(auth, 'Bearer valid');
    assert.equal(result.statusCode, 200);
    assert.equal(result.nextCalled, true);
    assert.equal(result.req.authUser?.id, 'auth-user-1');
  });

  it('returns 503 when token verification is unavailable', async () => {
    const auth = createRequireAuth(async () => { throw new Error('network unavailable'); });
    assert.equal((await invoke(auth, 'Bearer valid')).statusCode, 503);
  });

  it('maps Supabase rate limits and server failures to a service error', async () => {
    for (const error of [
      { status: 429, code: 'over_request_rate_limit', name: 'AuthApiError' },
      { status: 500, code: 'unexpected_failure', name: 'AuthRetryableFetchError' },
    ]) {
      const auth = createRequireAuth(async () => interpretSupabaseUserResponse(null, error));
      assert.equal((await invoke(auth, 'Bearer token')).statusCode, 503);
    }
  });

  it('requires a verified, allowlisted email for owner access', async () => {
    const owner = createRequireOwner(() => ' OWNER@example.com, other@example.com ');
    assert.equal((await invoke(owner, undefined, verifiedUser)).nextCalled, true);
    assert.equal((await invoke(owner, undefined, { ...verifiedUser, email_confirmed_at: undefined })).statusCode, 403);
    assert.equal((await invoke(owner, undefined, { ...verifiedUser, email: 'customer@example.com' })).statusCode, 403);
    assert.equal((await invoke(owner)).statusCode, 401);
  });

  it('logs out only the current browser session', async () => {
    let requestedScope = '';
    await signOutCurrentSession({
      auth: {
        async signOut(options) {
          requestedScope = options.scope;
          return { error: null };
        },
      },
    });
    assert.equal(requestedScope, 'local');
  });
});
