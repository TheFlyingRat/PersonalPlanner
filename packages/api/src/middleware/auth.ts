import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, getAccessTokenCookieName } from '../auth/jwt.js';

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
 * Enforces GDPR consent for non-auth API endpoints.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[getAccessTokenCookieName()];

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    if (!payload.emailVerified) {
      res.status(403).json({ error: 'Email not verified', code: 'EMAIL_NOT_VERIFIED' });
      return;
    }

    // Enforce GDPR consent for non-auth API routes
    // Exempt auth/*, calendars/*, settings/* so onboarding can complete before consent
    // Tokens issued before this field was added default to consented (hasGdprConsent === undefined → true)
    const url = req.originalUrl;
    const isExemptRoute = url.startsWith('/api/auth/') || url === '/api/auth'
      || url.startsWith('/api/calendars') || url.startsWith('/api/settings');
    if (payload.hasGdprConsent === false && !isExemptRoute) {
      res.status(403).json({ error: 'GDPR consent required', code: 'GDPR_CONSENT_REQUIRED' });
      return;
    }

    req.userId = payload.userId;
    req.userEmail = payload.email;
    req.userPlan = payload.plan;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
