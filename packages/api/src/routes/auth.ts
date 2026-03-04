import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { createOAuth2Client, getAuthUrl, exchangeCode } from '../google/index.js';
import { encrypt } from '../crypto.js';

const router = Router();

// Module-level variable to store the OAuth state for CSRF protection
let pendingOAuthState: string | null = null;

// POST /api/auth/google — initiate OAuth flow
router.post('/google', (_req, res) => {
  const oauth2Client = createOAuth2Client();
  const state = crypto.randomUUID();
  pendingOAuthState = state;
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
  if (!pendingOAuthState || state !== pendingOAuthState) {
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

    // Redirect to settings page with success
    res.redirect('/settings?google=connected');
  } catch (error: any) {
    console.error('OAuth error:', error);
    res.redirect('/settings?google=error');
  }
});

// GET /api/auth/google/status — check connection status
router.get('/google/status', (_req, res) => {
  const userRows = db.select().from(users).all();
  const connected = userRows.length > 0 && !!userRows[0].googleRefreshToken;
  res.json({ connected });
});

export default router;
