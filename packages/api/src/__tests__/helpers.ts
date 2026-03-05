import express from 'express';
import { timingSafeEqual } from 'crypto';

const TEST_API_KEY = 'test-api-key-12345';

/**
 * Creates a minimal Express app with JSON parsing and auth middleware,
 * mounting the given router at /api/<prefix>.
 */
export function createTestApp(prefix: string, router: express.Router): express.Express {
  const app = express();
  app.use(express.json());

  // Auth middleware matching production behavior
  app.use('/api', (req, res, next) => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const expected = `Bearer ${apiKey}`;
    if (
      !authHeader ||
      authHeader.length !== expected.length ||
      !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
    ) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  });

  app.use(`/api/${prefix}`, router);
  return app;
}

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_API_KEY}` };
}

export { TEST_API_KEY };
