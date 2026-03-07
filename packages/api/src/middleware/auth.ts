import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../auth/jwt.js';

declare global {
  namespace Express {
    interface Request {
      userId: string;
      userEmail: string;
      userPlan: string;
    }
  }
}

/**
 * JWT authentication middleware.
 * Extracts access token from httpOnly cookie, validates it,
 * and attaches userId, userEmail, userPlan to the request.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.access_token;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.userId;
    req.userEmail = payload.email;
    req.userPlan = payload.plan;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
