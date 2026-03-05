/**
 * Standalone script to get a Google Calendar refresh token.
 * Starts a temporary server, opens the browser, handles the callback.
 *
 * Usage: npx tsx scripts/get-google-token.ts
 */
import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const PORT = 9876; // Use a different port to avoid conflicts
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI,
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/calendar'],
});

console.log('\n=== Google Calendar Auth ===\n');
console.log('If the browser does not open automatically, visit:\n');
console.log(authUrl);
console.log('\n');

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/callback')) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('Missing authorization code');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Success!</h1><p>You can close this tab. Check the terminal for your refresh token.</p>');

    console.log('=== SUCCESS ===\n');
    console.log('Refresh Token:\n');
    console.log(tokens.refresh_token);
    console.log('\n');

    // Auto-store the token in the API
    try {
      const storeRes = await fetch('http://localhost:3000/api/auth/store-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refresh_token }),
      });
      if (storeRes.ok) {
        console.log('Token automatically stored in the app! Restart the server to begin polling.\n');
      } else {
        console.log('Could not auto-store token. Run manually:');
        console.log(`  curl -X POST http://localhost:3000/api/auth/store-token -H "Content-Type: application/json" -d '{"refreshToken":"${tokens.refresh_token}"}'`);
      }
    } catch {
      console.log('API not running. Store the token manually:');
      console.log(`  curl -X POST http://localhost:3000/api/auth/store-token -H "Content-Type: application/json" -d '{"refreshToken":"${tokens.refresh_token}"}'`);
    }

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500);
    res.end('Token exchange failed: ' + (err as Error).message);
    console.error('Token exchange failed:', err);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Listening on http://127.0.0.1:${PORT}/callback`);
  console.log('Opening browser...\n');
  open(authUrl).catch(() => {
    console.log('Could not open browser automatically. Please visit the URL above.');
  });
});
