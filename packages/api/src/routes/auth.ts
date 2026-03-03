import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { createOAuth2Client, getAuthUrl, exchangeCode, setCredentials } from '../google/index.js';

const router = Router();

// POST /api/auth/google — initiate OAuth flow
router.post('/google', (_req, res) => {
  const oauth2Client = createOAuth2Client();
  const url = getAuthUrl(oauth2Client);
  res.json({ redirectUrl: url });
});

// GET /api/auth/google/callback — handle OAuth callback
router.get('/google/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  try {
    const oauth2Client = createOAuth2Client();
    const tokens = await exchangeCode(oauth2Client, code);

    // Store refresh token in database
    const userRows = db.select().from(users).all();
    if (userRows.length > 0) {
      db.update(users)
        .set({ googleRefreshToken: tokens.refresh_token || null })
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
