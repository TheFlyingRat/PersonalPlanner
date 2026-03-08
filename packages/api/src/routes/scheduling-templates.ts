import { Router } from 'express';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { schedulingTemplates } from '../db/pg-schema.js';
import { createSchedulingTemplateSchema } from '../validation.js';
import { sendValidationError, sendError, validateUUID } from './helpers.js';

const router = Router();

// GET /api/scheduling-templates — list all templates for the current user
router.get('/', async (req, res) => {
  const rows = await db.select().from(schedulingTemplates)
    .where(eq(schedulingTemplates.userId, req.userId))
    .orderBy(asc(schedulingTemplates.createdAt));
  res.json({ templates: rows });
});

// POST /api/scheduling-templates — create a template
router.post('/', async (req, res) => {
  const parsed = createSchedulingTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const { name, startTime, endTime } = parsed.data;

  // Enforce max 8 templates per user
  const existing = await db.select().from(schedulingTemplates)
    .where(eq(schedulingTemplates.userId, req.userId));
  if (existing.length >= 8) {
    sendError(res, 400, 'Maximum of 8 templates allowed');
    return;
  }

  const inserted = await db.insert(schedulingTemplates).values({
    userId: req.userId,
    name,
    startTime,
    endTime,
  }).returning();

  res.status(201).json({ template: inserted[0] });
});

// DELETE /api/scheduling-templates/:id — delete a template
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id, res)) return;

  const deleted = await db.delete(schedulingTemplates)
    .where(and(eq(schedulingTemplates.id, id), eq(schedulingTemplates.userId, req.userId)))
    .returning();

  if (deleted.length === 0) {
    sendError(res, 404, 'Template not found');
    return;
  }

  res.json({ success: true });
});

export default router;
