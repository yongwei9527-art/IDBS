import { useState, useEffect, useRef, useCallback, createContext, useContext, type ReactNode } from 'react';
import { tokenStore, API_BASE } from './api';

interface WsContextType {
  connected: boolean;
  send: (msg: { type: string; channel?: string; payload?: unknown }) => void;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  onMessage: (handler: (msg: { type: string; channel?: string; payload?: unknown }) => void) => () => void;
}

const WsCtx = createContext<WsContextType>({
  connected: false,
  send: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  onMessage: () => () => {}
});

function buildUrl(): string {
  return location.origin.replace(/^http/, 'ws') + API_BASE + '/ws';
}

export function WsProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const handlersRef = useRef<Set<(msg: any) => void>>(new Set());
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
        const msg = JSON.parse(e.data);
        if (msg.type === 'ready') {
          authenticatedRef.current = true;
          setConnected(true);
          clearTimeout(reconnectTimer.current);
          for (const channel of subscriptionsRef.current) {
            ws.send(JSON.stringify({ type: 'subscribe', channel }));
          }
        }
        for (const h of handlersRef.current) h(msg);
      } catch {}
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
    window.addEventListener('idbs:auth-changed', handleAuthChanged);
    return () => {
      window.removeEventListener('idbs:auth-changed', handleAuthChanged);
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

  const onMessage = useCallback((handler: (msg: any) => void) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  return <WsCtx.Provider value={{ connected, send, subscribe, unsubscribe, onMessage }}>{children}</WsCtx.Provider>;
}

export function useWs() {
  return useContext(WsCtx);
}
