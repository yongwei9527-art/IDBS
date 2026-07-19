import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryClientConfig } from './lib/query-defaults';
import { AuthProvider } from './features/auth/use-auth';
import { WsProvider } from './lib/ws';
import { Toaster } from './components/ui/toaster';
import './styles/globals.css';
import './styles/visual-system.css';
import { routes } from './routes';

const queryClient = new QueryClient(queryClientConfig);

// 部署子路径 /v5/：从当前 URL 推导出 router basepath，让 router 内部仍按
// /login、/admin/dashboard 等内部路径匹配。
// index.html 始终位于 /v5/index.html，故 location.pathname 必以 /v5 开头。
function resolveBasepath(): string {
  if (typeof window === 'undefined') return '/';
  const pathname = window.location.pathname;
  if (pathname.indexOf('/v5') === 0) return '/v5';
  return '/';
}
const basepath = resolveBasepath();

const router = createRouter({
  routeTree: routes,
  defaultPreload: 'intent',
  context: { queryClient },
  basepath
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <WsProvider>
        <Toaster />
        <RouterProvider router={router} />
      </WsProvider>
    </AuthProvider>
  </QueryClientProvider>
);
