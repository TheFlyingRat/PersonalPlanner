import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { createOAuth2Client, getAuthUrl, exchangeCode } from '../google/index.js';
import { encrypt } from '../crypto.js';
import { pollingRef } from '../polling-ref.js';

const router = Router();

// Module-level variable to store the OAuth state for CSRF protection (with expiry)
let pendingOAuthState: { value: string; expiresAt: number } | null = null;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// POST /api/auth/google — initiate OAuth flow
router.post('/google', (_req, res) => {
  const oauth2Client = createOAuth2Client();
  const state = crypto.randomUUID();
  pendingOAuthState = { value: state, expiresAt: Date.now() + OAUTH_STATE_TTL_MS };
  const url = getAuthUrl(oauth2Client, state);
  res.json({ redirectUrl: url });
});

// GET /api/auth/google/callback — handle OAuth callback
router.get('/google/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  // Verify OAuth state parameter (CSRF protection)
  const state = req.query.state as string | undefined;
  const now = Date.now();
  if (
    !pendingOAuthState ||
    state !== pendingOAuthState.value ||
    now > pendingOAuthState.expiresAt
  ) {
    pendingOAuthState = null;
    res.status(403).json({ error: 'Invalid OAuth state' });
    return;
  }
  pendingOAuthState = null;

  try {
    const oauth2Client = createOAuth2Client();
    const tokens = await exchangeCode(oauth2Client, code);

    // Encrypt the refresh token before storing
    const encryptedToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;

    // Store encrypted refresh token in database
    const userRows = db.select().from(users).all();
    if (userRows.length > 0) {
      db.update(users)
        .set({ googleRefreshToken: encryptedToken })
        .where(eq(users.id, userRows[0].id))
        .run();
    }

    // Initialize polling if not already running
    if (!pollingRef.manager && pollingRef.init) {
      pollingRef.init().catch((err) => console.error('Post-OAuth polling init failed:', err));
    }

    // Redirect to frontend settings page with success
    const frontendOrigin = process.env.CORS_ORIGIN || `${req.protocol}://${req.get('host')}`;
    res.redirect(`${frontendOrigin}/settings?google=connected`);
  } catch (error: any) {
    console.error('OAuth error:', error);
    const frontendOrigin = process.env.CORS_ORIGIN || `${req.protocol}://${req.get('host')}`;
    res.redirect(`${frontendOrigin}/settings?google=error`);
  }
});

// POST /api/auth/store-token — manually store a refresh token (dev helper, non-production only)
router.post('/store-token', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { refreshToken } = req.body;
  if (!refreshToken || typeof refreshToken !== 'string') {
    res.status(400).json({ error: 'Missing refreshToken' });
    return;
  }
  if (refreshToken.length > 512) {
    res.status(400).json({ error: 'Invalid refreshToken' });
    return;
  }

  const encryptedToken = encrypt(refreshToken);
  const userRows = db.select().from(users).all();
  if (userRows.length > 0) {
    db.update(users)
      .set({ googleRefreshToken: encryptedToken })
      .where(eq(users.id, userRows[0].id))
      .run();
  }

  res.json({ success: true, message: 'Token stored. Restart the server to begin polling.' });
});

// GET /api/auth/google/status — check connection status
router.get('/google/status', (_req, res) => {
  const userRows = db.select().from(users).all();
  const connected = userRows.length > 0 && !!userRows[0].googleRefreshToken;
  res.json({ connected });
});

export default router;
