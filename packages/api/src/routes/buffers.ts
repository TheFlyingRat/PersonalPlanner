import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { bufferConfig } from '../db/schema.js';
import type { BufferConfig } from '@reclaim/shared';
import { updateBufferSchema } from '../validation.js';

const router = Router();

// GET /api/buffers — get buffer config
router.get('/', (_req, res) => {
  const row = db.select().from(bufferConfig).where(eq(bufferConfig.id, 'default')).get();

  if (!row) {
    res.status(404).json({ error: 'Buffer config not found' });
    return;
  }

  res.json(toBufferConfig(row));
});

// PUT /api/buffers — update (upsert single row)
router.put('/', (req, res) => {
  const parsed = updateBufferSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const body = parsed.data;

  const existing = db.select().from(bufferConfig).where(eq(bufferConfig.id, 'default')).get();

  if (existing) {
    const updates: Record<string, unknown> = {};

    if (body.travelTimeMinutes !== undefined) updates.travelTimeMinutes = body.travelTimeMinutes;
    if (body.decompressionMinutes !== undefined) updates.decompressionMinutes = body.decompressionMinutes;
    if (body.breakBetweenItemsMinutes !== undefined) updates.breakBetweenItemsMinutes = body.breakBetweenItemsMinutes;
    if (body.applyDecompressionTo !== undefined) updates.applyDecompressionTo = body.applyDecompressionTo;

    db.update(bufferConfig).set(updates).where(eq(bufferConfig.id, 'default')).run();
  } else {
    db.insert(bufferConfig).values({
      id: 'default',
      travelTimeMinutes: body.travelTimeMinutes ?? 15,
      decompressionMinutes: body.decompressionMinutes ?? 10,
      breakBetweenItemsMinutes: body.breakBetweenItemsMinutes ?? 5,
      applyDecompressionTo: body.applyDecompressionTo ?? 'all',
    }).run();
  }

  const updated = db.select().from(bufferConfig).where(eq(bufferConfig.id, 'default')).get();
  res.json(toBufferConfig(updated!));
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
