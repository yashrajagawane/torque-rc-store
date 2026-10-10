import express from 'express';

type DatabaseFailure = {
  name?: unknown;
  code?: unknown;
  errno?: unknown;
  syscall?: unknown;
};

const SAFE_NODE_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
  'ENOTFOUND', 'EAI_AGAIN', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
]);

const SAFE_SQLSTATE = /^[0-9A-Z]{5}$/;

function classifyDatabaseFailure(error: unknown): Record<string, string> {
  const candidate = (typeof error === 'object' && error !== null ? error : {}) as DatabaseFailure;
  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  const name = typeof candidate.name === 'string' ? candidate.name : undefined;
  const category = code && /^28/.test(code)
    ? 'authentication'
    : code && /^08/.test(code)
      ? 'database_connection'
      : code === '57014'
        ? 'query_timeout'
        : code && SAFE_SQLSTATE.test(code)
          ? 'postgresql'
    : code && SAFE_NODE_CODES.has(code)
      ? 'network_or_tls'
      : name === 'Error' || name === 'DatabaseError'
        ? 'database'
        : 'unknown';
  const details: Record<string, string> = { category };
  if (code && (SAFE_SQLSTATE.test(code) || SAFE_NODE_CODES.has(code))) details.code = code;
  if (typeof candidate.errno === 'string' && SAFE_NODE_CODES.has(candidate.errno)) details.errno = candidate.errno;
  if (typeof candidate.syscall === 'string' && /^[a-z_]+$/.test(candidate.syscall)) details.syscall = candidate.syscall;
  return details;
}

export function createHealthRouter(checkDatabase: () => Promise<unknown>) {
  const router = express.Router();
  router.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  router.get('/api/ready', async (_req, res) => {
    try {
      await checkDatabase();
      res.status(200).json({ status: 'ready' });
    } catch (error) {
      // Keep the response generic, but record only a bounded classification so
      // deployment logs can distinguish configuration, network/TLS, and SQL
      // failures without ever receiving URLs, credentials, or raw messages.
      console.error('[READINESS_DATABASE_CHECK_FAILED]', classifyDatabaseFailure(error));
      res.status(503).json({ error: 'Service temporarily unavailable.' });
    }
  });
  return router;
}
