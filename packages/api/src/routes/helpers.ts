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

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUUID(id: string, res: Response): boolean {
  if (!UUID_REGEX.test(id)) {
    sendError(res, 400, 'Invalid ID format');
    return false;
  }
  return true;
}

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): { success: true; data: T } | { success: false; error: ZodError } {
  const result = schema.safeParse(body);
  if (!result.success) return { success: false, error: result.error };
  return { success: true, data: result.data };
}
