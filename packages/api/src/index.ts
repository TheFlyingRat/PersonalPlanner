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
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
  }
  if (!process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET must be set in production');
  }
  if (!process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be set in production');
  }
}
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn('WARNING: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. Google Calendar integration will not work.');
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
const PORT = parseInt(process.env.PORT || '3000', 10);

// Derive WebSocket origin from CORS_ORIGIN for CSP connectSrc
const wsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim().replace(/^http/, 'ws'));

// Security headers — allow Geist font CDN
// Note: SvelteKit static builds emit inline <script> and <style> tags,
// so both 'unsafe-inline' directives are required.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", ...wsOrigins, ...wsOrigins.map((o) => o.replace('ws:', 'wss:'))],
    },
  },
}));

// CORS — supports multiple origins (comma-separated in CORS_ORIGIN)
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());
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

// Stricter rate limits for public endpoints
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many booking requests, please try again later.' },
});
app.use('/api/links/:slug/book', bookingLimiter);
app.use('/api/book/:slug', bookingLimiter);

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
app.use('/api/auth/google/callback', authLimiter);

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
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
    closeWebSocket();
    server.close(async () => {
      console.log('HTTP server closed.');
      await closeDb();
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
