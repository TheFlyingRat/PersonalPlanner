import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';


// Startup validation
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be set in production and be at least 32 characters');
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be set in production and be at least 32 characters');
  }
  if (!process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be set in production');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set in production');
  }
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY must be set in production');
  }
  if (!process.env.COOKIE_DOMAIN) {
    console.warn('WARNING: COOKIE_DOMAIN is not set in production. Cross-subdomain cookies will not work.');
  }
}
// Validate ENCRYPTION_KEY format if present (AES-256-GCM requires 64 hex chars = 32 bytes)
if (process.env.ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) {
  throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (256 bits for AES-256-GCM)');
}
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn('WARNING: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. Google Calendar integration will not work.');
}
if (process.env.NODE_ENV === 'production' && !process.env.SMTP_HOST) {
  console.warn('WARNING: SMTP_HOST is not set in production. Email verification and password reset will log to console instead of sending emails.');
}

import { closeDb } from './db/pg-index.js';
import { runMigrations } from './db/migrate.js';
import { schedulerRegistry } from './scheduler-registry.js';

import habitsRouter from './routes/habits.js';
import tasksRouter from './routes/tasks.js';
import meetingsRouter from './routes/meetings.js';
import focusRouter from './routes/focus.js';
import buffersRouter from './routes/buffers.js';
import scheduleRouter from './routes/schedule.js';
import linksRouter from './routes/links.js';
import analyticsRouter from './routes/analytics.js';
import authRouter from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import calendarsRouter from './routes/calendars.js';
import searchRouter from './routes/search.js';
import activityRouter from './routes/activity.js';
import bookingRouter from './routes/booking.js';
import quickAddRouter from './routes/quick-add.js';

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY ? parseInt(process.env.TRUST_PROXY, 10) : 0);
const PORT = parseInt(process.env.PORT || '3000', 10);

// Derive allowed origins for CORS, CSP, and WebSocket origin checks
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());
const wsOrigins = allowedOrigins.map((o) => o.replace(/^http/, 'ws'));

// Security headers — allow Geist font CDN
// TODO(H5): 'unsafe-inline' in scriptSrc/styleSrc is required because SvelteKit
// static builds emit inline <script> and <style> tags. The proper fix is
// nonce-based CSP configured in the SvelteKit build pipeline (owned by frontend).
// See: https://kit.svelte.dev/docs/configuration#csp
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", ...allowedOrigins, ...wsOrigins, ...wsOrigins.map((o) => o.replace('ws:', 'wss:'))],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));

// Export for WebSocket origin validation
export { allowedOrigins };

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// Global rate limit: 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', globalLimiter);

// Booking rate limiter — applied inline on router handlers in links.ts and booking.ts
export const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many booking requests, please try again later.' },
});

const rescheduleLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reschedule requests, please try again later.' },
});
app.use('/api/schedule/reschedule', rescheduleLimiter);

// Strict rate limit for OAuth initiation
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many auth requests, please try again later.' },
});
app.use('/api/auth/google', authLimiter);

// JWT authentication middleware
import { requireAuth } from './middleware/auth.js';

const PUBLIC_ROUTE_PATTERNS: RegExp[] = [
  /^\/api\/health$/,
  /^\/api\/auth\//,
  /^\/api\/book\//,
];

app.use('/api', (req, res, next) => {
  const fullPath = `/api${req.path}`;
  const isPublic = PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(fullPath));

  if (isPublic) {
    next();
    return;
  }

  requireAuth(req, res, next);
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// API Routes
app.use('/api/habits', habitsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/focus-time', focusRouter);
app.use('/api/buffers', buffersRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/links', linksRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/calendars', calendarsRouter);
app.use('/api/search', searchRouter);
app.use('/api/activity', activityRouter);
app.use('/api/book', bookingRouter);
app.use('/api/quick-add', quickAddRouter);


// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// WebSocket + Scheduler Registry
// ============================================================

import { initWebSocket, closeWebSocket } from './ws.js';

// ============================================================
// Server Startup
// ============================================================

async function startServer() {
  // Run database migrations
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    await runMigrations(databaseUrl);
  }

  // Start schedulers for all users with Google connections
  schedulerRegistry.startAll()
    .then(() => {
      console.log('[scheduler] All user schedulers initialized');
    })
    .catch((err) => {
      console.error('[scheduler] Failed to start schedulers:', err);
    });

  const server = app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
  initWebSocket(server);

  async function gracefulShutdown(signal: string) {
    console.log(`${signal} received. Shutting down gracefully...`);
    await schedulerRegistry.stopAll();
    await closeWebSocket();
    server.close(async () => {
      console.log('HTTP server closed.');
      await closeDb();
      process.exit(0);
    });
    // Force-drain keep-alive connections after 5s
    setTimeout(() => {
      console.log('Draining keep-alive connections...');
      server.closeAllConnections();
    }, 5_000);
    setTimeout(() => {
      console.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // INFRA-C1: Catch unhandled errors to prevent silent crashes
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled rejection:', reason);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
