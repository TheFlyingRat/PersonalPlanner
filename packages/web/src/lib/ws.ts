// Module-level singleton WebSocket connection.
// A single shared connection is opened on first subscribe() and closed when
// the last listener unsubscribes. Reconnects automatically with exponential backoff.
import { browser } from '$app/environment';
import { PUBLIC_API_URL } from '$env/static/public';

type MessageHandler = (data: { type: string; reason: string; timestamp: string }) => void;
export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';
type ConnectionStateHandler = (state: ConnectionState) => void;

let ws: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;
const listeners = new Set<MessageHandler>();
const connectionListeners = new Set<ConnectionStateHandler>();
let currentState: ConnectionState = 'disconnected';

function setConnectionState(state: ConnectionState): void {
  if (state === currentState) return;
  currentState = state;
  connectionListeners.forEach((handler) => handler(state));
}

function getWsUrl(): string {
  const apiUrl = PUBLIC_API_URL || '';
  if (apiUrl) {
    // Derive WS URL from API URL: https://api.example.com/api → wss://api.example.com/ws
    const url = new URL(apiUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    return url.toString();
  }
  // Same-origin fallback (dev or co-hosted)
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function connect(): void {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    reconnectDelay = 1000;
    setConnectionState('connected');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      listeners.forEach((handler) => handler(data));
    } catch {
      // Ignore non-JSON messages (pong, etc.)
    }
  };

  ws.onclose = () => {
    ws = null;
    setConnectionState('reconnecting');
    scheduleReconnect();
  };

  ws.onerror = () => {
    // No explicit close needed — the browser fires onclose automatically after onerror.
  };
}

function scheduleReconnect(): void {
  if (reconnectTimeout) return;
  // Wait the current delay, then double it for the *next* attempt (exponential backoff).
  // Delay doubles after scheduling so the first reconnect uses the initial 1s delay.
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    connect();
  }, reconnectDelay);
}

export function subscribe(handler: MessageHandler): () => void {
  if (!browser) return () => {};
  listeners.add(handler);
  if (listeners.size === 1) connect();

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && ws === null) {
      connect();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    listeners.delete(handler);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (listeners.size === 0 && connectionListeners.size === 0) disconnect();
  };
}

export function disconnect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  reconnectDelay = 1000;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  setConnectionState('disconnected');
}

export function subscribeConnectionState(handler: ConnectionStateHandler): () => void {
  if (!browser) return () => {};
  connectionListeners.add(handler);
  // Ensure a connection is initiated when someone is watching state,
  // but respect any pending reconnect backoff
  if (ws === null && currentState !== 'connected' && !reconnectTimeout) {
    connect();
  }
  // Immediately emit current state
  handler(currentState);

  // Listen for browser online/offline events
  const onOffline = () => setConnectionState('disconnected');
  const onOnline = () => {
    if (ws === null) {
      setConnectionState('reconnecting');
      connect();
    }
  };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);

  return () => {
    connectionListeners.delete(handler);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
  };
}
