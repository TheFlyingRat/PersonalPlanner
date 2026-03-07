import { type Response } from 'express';
import { type ZodSchema, type ZodError } from 'zod/v4';

export function sendValidationError(res: Response, error: ZodError) {
  return res.status(400).json({ error: 'Validation failed', details: error.issues });
}

export function sendNotFound(res: Response, entity: string) {
  return res.status(404).json({ error: `${entity} not found` });
}

export function sendError(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): { success: true; data: T } | { success: false; error: ZodError } {
  const result = schema.safeParse(body);
  if (!result.success) return { success: false, error: result.error };
  return { success: true, data: result.data };
}
