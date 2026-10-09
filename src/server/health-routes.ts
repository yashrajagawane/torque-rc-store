import express from 'express';

export function createHealthRouter(checkDatabase: () => Promise<unknown>) {
  const router = express.Router();
  router.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  router.get('/api/ready', async (_req, res) => {
    try {
      await checkDatabase();
      res.status(200).json({ status: 'ready' });
    } catch {
      res.status(503).json({ error: 'Service temporarily unavailable.' });
    }
  });
  return router;
}
