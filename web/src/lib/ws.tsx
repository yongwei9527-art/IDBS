import { useState, useEffect, useRef, useCallback, createContext, useContext, type ReactNode } from 'react';
import { tokenStore, getApiBase } from './api';
import { prepareNativeNotifications, presentNativeMessageNotification } from '@/features/notification/native-notifications';

interface RealtimeMessage {
  type: string;
  channel?: string;
  payload?: unknown;
}

interface WsContextType {
  connected: boolean;
  send: (msg: { type: string; channel?: string; payload?: unknown }) => void;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  onMessage: (handler: (msg: RealtimeMessage) => void) => () => void;
}

const WsCtx = createContext<WsContextType>({
  connected: false,
  send: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  onMessage: () => () => {}
});

function buildUrl(): string {
  const apiBase = getApiBase();
  const httpBase = apiBase.startsWith('http') ? apiBase : location.origin + apiBase;
  return httpBase.replace(/^http/, 'ws') + '/ws';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function notifyNativeMessage(message: RealtimeMessage) {
  if (message.type !== 'new_message' || !message.channel?.startsWith('notifications:')) return;
  const payload = asRecord(message.payload);
  if (!payload || payload.is_sender === true) return;
  // Keep system banners privacy-safe: never mirror chat content or user details.
  void presentNativeMessageNotification({ title: '新消息', body: '您收到一条新消息' });
}

export function WsProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const handlersRef = useRef<Set<(msg: RealtimeMessage) => void>>(new Set());
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const authenticatedRef = useRef(false);

  const doConnect = useCallback(() => {
    const prev = wsRef.current;
    if (prev?.readyState === WebSocket.OPEN) return;
    if (prev) { prev.onclose = null; prev.onerror = null; prev.close(); }
    const tok = tokenStore.get();
    if (!tok) return;
    const ws = new WebSocket(buildUrl());
    wsRef.current = ws;
    authenticatedRef.current = false;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: tok }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as RealtimeMessage;
        if (msg.type === 'ready') {
          authenticatedRef.current = true;
          setConnected(true);
          clearTimeout(reconnectTimer.current);
          void prepareNativeNotifications();
          for (const channel of subscriptionsRef.current) {
            ws.send(JSON.stringify({ type: 'subscribe', channel }));
          }
        }
        notifyNativeMessage(msg);
        for (const h of handlersRef.current) h(msg);
      } catch {
        // Ignore malformed or non-JSON WebSocket payloads.
      }
    };
    ws.onclose = () => {
      authenticatedRef.current = false;
      setConnected(false);
      wsRef.current = null;
      scheduleReconnect();
    };
    ws.onerror = () => ws.close();
    return ws;
  }, []);

  const scheduleReconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(() => { if (tokenStore.get()) doConnect(); }, 5_000);
  }, [doConnect]);

  useEffect(() => {
    doConnect();
    const handleAuthChanged = () => {
      if (tokenStore.get()) doConnect();
      else if (wsRef.current) wsRef.current.close(1000, 'signed out');
    };
    const handleOriginChanged = () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close(1000, 'api origin changed');
        wsRef.current = null;
      }
      if (tokenStore.get()) doConnect();
    };
    window.addEventListener('laboratory-management-system:auth-changed', handleAuthChanged);
    window.addEventListener('laboratory-management-system:api-origin-changed', handleOriginChanged);
    return () => {
      window.removeEventListener('laboratory-management-system:auth-changed', handleAuthChanged);
      window.removeEventListener('laboratory-management-system:api-origin-changed', handleOriginChanged);
      clearTimeout(reconnectTimer.current);
      authenticatedRef.current = false;
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [doConnect]);

  const send = useCallback((msg: { type: string; channel?: string; payload?: unknown }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);

  const subscribe = useCallback((channel: string) => {
    subscriptionsRef.current.add(channel);
    if (authenticatedRef.current) send({ type: 'subscribe', channel });
  }, [send]);

  const unsubscribe = useCallback((channel: string) => {
    subscriptionsRef.current.delete(channel);
    if (authenticatedRef.current) send({ type: 'unsubscribe', channel });
  }, [send]);

  const onMessage = useCallback((handler: (msg: RealtimeMessage) => void) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  return <WsCtx.Provider value={{ connected, send, subscribe, unsubscribe, onMessage }}>{children}</WsCtx.Provider>;
}

export function useWs() {
  return useContext(WsCtx);
}