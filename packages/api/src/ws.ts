import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import { verifyAccessToken } from './auth/jwt.js';
import { schedulerRegistry } from './scheduler-registry.js';

let wss: WebSocketServer | null = null;

// Per-user WebSocket channels
const userChannels = new Map<string, Set<WebSocket>>();

function parseAccessTokenFromCookies(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=');
    if (name === 'access_token') {
      return rest.join('=');
    }
  }
  return null;
}

function authenticateWs(req: IncomingMessage): string | null {
  // Try cookie first (same-origin, httpOnly cookies are sent automatically)
  const token = parseAccessTokenFromCookies(req.headers.cookie);

  // Fallback: query parameter
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const queryToken = url.searchParams.get('token');

  const provided = token || queryToken;
  if (!provided) return null;

  try {
    const payload = verifyAccessToken(provided);
    return payload.userId;
  } catch {
    return null;
  }
}

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  // Heartbeat: ping every 30s, terminate stale clients
  const heartbeat = setInterval(() => {
    wss!.clients.forEach((ws: any) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws: any, req: IncomingMessage) => {
    const userId = authenticateWs(req);
    if (!userId) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    ws.isAlive = true;
    ws.userId = userId;

    // Add to user's channel
    if (!userChannels.has(userId)) {
      userChannels.set(userId, new Set());
    }
    userChannels.get(userId)!.add(ws);

    // Cancel idle timer since user has an active connection
    schedulerRegistry.cancelIdle(userId);

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});

    ws.on('close', () => {
      const channels = userChannels.get(userId);
      if (channels) {
        channels.delete(ws);
        if (channels.size === 0) {
          userChannels.delete(userId);
          // Start idle timer — if no reconnection within 30 min, destroy scheduler
          schedulerRegistry.scheduleIdle(userId);
        }
      }
    });
  });
}

/** Broadcast a message to a specific user's WebSocket connections */
export function broadcastToUser(userId: string, event: string, reason: string, data?: unknown): void {
  const channels = userChannels.get(userId);
  if (!channels || channels.size === 0) return;

  const message = JSON.stringify({
    type: event,
    reason,
    timestamp: new Date().toISOString(),
    ...(data !== undefined ? { data } : {}),
  });

  for (const client of channels) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/** Broadcast to ALL connected clients (used for system-wide messages) */
export function broadcast(event: string, reason: string, data?: unknown): void {
  if (!wss) return;
  const message = JSON.stringify({
    type: event,
    reason,
    timestamp: new Date().toISOString(),
    ...(data !== undefined ? { data } : {}),
  });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/** Check if a user has active WebSocket connections */
export function hasActiveConnections(userId: string): boolean {
  const channels = userChannels.get(userId);
  return !!channels && channels.size > 0;
}

export function closeWebSocket(): void {
  if (wss) wss.close();
}
