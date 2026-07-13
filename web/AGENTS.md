# IDBS 5.0 前端子项目 (`web/`)

独立子项目（ESM, `"type": "module"`）。Vite 6 + React 18 + TypeScript + Tailwind v3 + shadcn/ui + TanStack Query/Router。

## 工作约定

- 仅手写路由树（`src/routes.tsx`），**不**使用 TanStack Router file-based 生成插件。
- `navigate({ to: ... })` 类型在动态字符串路径下无法完成推断，统一使用 `as any` 类型断言绕过约束。
- 关于 `<Link>` 的 `to`/`params` 类型约束同理：动态路由用 `<button>` + `useNavigate()` 组合替代。
- 组件原子基于 shadcn/ui（`src/components/ui/*`）；设计 token 通过 HSL 变量与 `--radius 0.625rem` 定义。
- access token 存储在 localStorage：`idbs.access_token`；refresh token 使用 HttpOnly Cookie，401 自动触发一次 refresh-retry。
- `API_BASE = '/api/v5'`；Vite 代理 `/api`、`/wechat`、`/uploads` 到后端 3000 端口（dev）。
- 构建产物输出到 `../public/v5/`，`base: '/v5/'`。

## 常用命令

- `npm run typecheck` — `tsc -p tsconfig.json --noEmit`，类型检查（只读，不产文件）。
- `npm run build` — `tsc --noEmit && vite build`，产出 `../public/v5/`。
- `npm run dev` — `vite`，启动开发服务器（代理到根项目后端）。
- `npm run lint` — 如配置 ESLint/Prettier 后运行。

## 与后端的契约

- 成功响应: `{ "code": 0, "data": <T>, "message": "success" }`，封装在 `lib/api.ts` 的 `request()` 中剥离 `.data`。
- 失败响应: 默认 `{ ok: false, code, status, message, data: null }`；`Accept: application/problem+json` 或 `?problem=1` 时返回 RFC 7807 `problem+json`。
- 401 由 `request()` 自动 refresh；仍失败则清空 token 并抛错。
- WebSocket: `/api/v5/ws`，连接后首条消息发送 access JWT 完成鉴权；频道通过订阅/解绑，聊天频道必须通过成员校验。

## 文件布局

- `src/components/ui/` — shadcn 原子组件
- `src/lib/` — 基础设施（api.ts、ws.tsx、utils.ts 等）
- `src/features/` — 按域分组的页面与 `*-api.ts` hook
- `src/routes.tsx` — 手写路由树
- `src/main.tsx` — provider 树（QueryClient → AuthProvider → WsProvider → Toaster + RouterProvider）
