import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { bufferConfig } from '../db/pg-schema.js';
import type { BufferConfig } from '@cadence/shared';
import { updateBufferSchema } from '../validation.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError, sendNotFound } from './helpers.js';

const router = Router();

// GET /api/buffers — get buffer config for the current user
router.get('/', async (req, res) => {
  const userId = req.userId;
  const rows = await db.select().from(bufferConfig).where(eq(bufferConfig.userId, userId));

  if (rows.length === 0) {
    sendNotFound(res, 'Buffer config');
    return;
  }

  res.json(toBufferConfig(rows[0]));
});

// PUT /api/buffers — update (upsert single row per user)
router.put('/', async (req, res) => {
  const parsed = updateBufferSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const userId = req.userId;
  const body = parsed.data;

  const existing = await db.select().from(bufferConfig).where(eq(bufferConfig.userId, userId));

  if (existing.length > 0) {
    const updates: Record<string, unknown> = {};

    if (body.travelTimeMinutes !== undefined) updates.travelTimeMinutes = body.travelTimeMinutes;
    if (body.decompressionMinutes !== undefined) updates.decompressionMinutes = body.decompressionMinutes;
    if (body.breakBetweenItemsMinutes !== undefined) updates.breakBetweenItemsMinutes = body.breakBetweenItemsMinutes;
    if (body.applyDecompressionTo !== undefined) updates.applyDecompressionTo = body.applyDecompressionTo;

    await db.update(bufferConfig).set(updates).where(eq(bufferConfig.userId, userId));
  } else {
    await db.insert(bufferConfig).values({
      userId,
      travelTimeMinutes: body.travelTimeMinutes ?? 15,
      decompressionMinutes: body.decompressionMinutes ?? 10,
      breakBetweenItemsMinutes: body.breakBetweenItemsMinutes ?? 5,
      applyDecompressionTo: body.applyDecompressionTo ?? 'all',
    });
  }

  const updated = await db.select().from(bufferConfig).where(eq(bufferConfig.userId, userId));
  broadcastToUser(req.userId, 'schedule_updated', 'Buffer config updated');
  triggerReschedule('Buffer config updated', req.userId);
  res.json(toBufferConfig(updated[0]));
});

function toBufferConfig(row: typeof bufferConfig.$inferSelect): BufferConfig {
  return {
    id: row.id,
    travelTimeMinutes: row.travelTimeMinutes ?? 15,
    decompressionMinutes: row.decompressionMinutes ?? 10,
    breakBetweenItemsMinutes: row.breakBetweenItemsMinutes ?? 5,
    applyDecompressionTo: (row.applyDecompressionTo ?? 'all') as BufferConfig['applyDecompressionTo'],
  };
}

export default router;
