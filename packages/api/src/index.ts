import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { resolve } from 'path';

import { seed } from './db/seed.js';

import habitsRouter from './routes/habits.js';
import tasksRouter from './routes/tasks.js';
import meetingsRouter from './routes/meetings.js';
import focusRouter from './routes/focus.js';
import buffersRouter from './routes/buffers.js';
import scheduleRouter from './routes/schedule.js';
import linksRouter from './routes/links.js';
import analyticsRouter from './routes/analytics.js';
import authRouter from './routes/auth.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors());
app.use(express.json());

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

// Serve static SvelteKit build in production
const webBuildPath = resolve(import.meta.dirname, '../../web/build');
if (existsSync(webBuildPath)) {
  app.use(express.static(webBuildPath));
}

// Initialize database with seed data
seed();

app.listen(PORT, () => {
  console.log(`Reclaim API server running on http://localhost:${PORT}`);
});

export default app;
