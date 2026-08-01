# Android APK Build Guide

本项目使用 Capacitor 将 Vite/React 前端打包为 Android APK。APK 内是静态前端；Node.js + PostgreSQL 后端仍需部署在可访问的服务器上。
## 首次服务器配对（推荐）

部署完成后在手机浏览器打开 `https://<服务器>/download`，安装管理员发布的 APK，并在 App 中使用“扫码配对”扫描下载页二维码。二维码使用以下深度链接格式：

```text
labapp://pair?v=1&server=https%3A%2F%2Flab.example.com&token=<短期令牌>
```

Android 仅接受规范的 HTTPS 服务器地址。扫码载荷中的 `token` 只临时保留在内存中；App 会调用服务器的 `POST /api/v5/app-pairing/exchange` 完成验证，然后保存服务器返回的规范地址并清除 token。该过程只配置服务器地址，不会登录、不会携带管理员密码；完成后必须用普通用户自己的账号和密码登录。

二维码或 token 过期时，返回 `/download` 刷新页面重新扫码。无法扫码时，可继续使用登录页已有的手动服务器地址输入作为后备。禁止将管理员密码、数据库密码、JWT、`APP_PAIRING_SECRET` 或 Android 签名密钥放入 APK、二维码或 GitHub。

## 1. 有域名 / 无域名

APK **不再写死** 后端地址。用户在登录页填写服务器地址，系统会自动补协议并推导 API / WebSocket 地址：

| 场景 | 登录页填写示例 | 实际 API 请求 | 适用范围 |
| --- | --- | --- | --- |
| 有域名 VPS（推荐生产） | `rent.example.com` 或 `https://rent.example.com` | `https://rent.example.com/api/v5` | 正式 APK / 浏览器，推荐长期使用。 |
| 无域名 VPS | `203.0.113.10` 或 `http://203.0.113.10` | `http://203.0.113.10/api/v5` | 可先用 IP 跑通；安全性不如 HTTPS 域名。 |
| 局域网调试 | `192.168.1.13:3000` | `http://192.168.1.13:3000/api/v5` | 开发机直连 Vite/API 调试。 |
| 模拟器访问本机 | `10.0.2.2:3000` | `http://10.0.2.2:3000/api/v5` | Android 模拟器调试。 |

规则：

- 域名默认走 **HTTPS**。
- 公网 IP / 局域网 IP / localhost 默认走 **HTTP**。
- VPS 通过 Nginx 对外提供 80 端口时，登录页填 `服务器公网IP` 即可，不需要写 `:3000`。
- 地址保存在手机 `localStorage` 键 `laboratory-management-system.api_origin`，换服务器可直接在登录页改。
- WebSocket 地址由运行时服务器地址推导：`ws(s)://host/api/v5/ws`。

后端 `.env` 的 `CORS_ORIGIN` 需要同时放行 APK WebView 来源 `https://localhost` 和真实服务器来源：

```env
# 有域名生产
CORS_ORIGIN=https://localhost,https://rent.example.com

# 无域名/IP 临时使用
CORS_ORIGIN=https://localhost,http://203.0.113.10

# 局域网调试
CORS_ORIGIN=https://localhost,http://127.0.0.1:3000,http://192.168.1.13:3000
```

安全建议：生产优先使用 HTTPS 域名；无域名 HTTP 可用于临时部署、内网或初次验收，但账号、令牌和业务数据不会获得 HTTPS 传输加密保护。正式 APK 若必须长期连接 `http://公网IP`，需要明确接受明文传输风险后再放开 Android 明文网络策略。

## 2. 创建 / 同步 Android 工程'@

ReplaceOnce 'docs/production-security-checklist.md' @'
| `CORS_ORIGIN` | 明确域名，勿用 `*` | `https://lab.example.com` |

首次：

```powershell
npm --prefix web run build:android
npm --prefix web run android:add
```

前端变更后：

```powershell
npm --prefix web run android:sync
```

可选构建时默认地址（用户仍可在登录页覆盖）：

```powershell
$env:VITE_API_ORIGIN='http://192.168.1.13:3000'
npm --prefix web run android:sync
```

## 3. 构建 Debug APK

需要 **Java 21**（Android Studio JBR）与 Android SDK：

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
npm --prefix web run android:debug
```

输出：

`web/android/app/build/outputs/apk/debug/app-debug.apk`

## 4. 构建 Release APK

配置签名后：

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
npm --prefix web run android:release
```

输出：

`web/android/app/build/outputs/apk/release/app-release.apk`

## 5. USB 连接与开发者选项（华为平板 GOT-W09 等）

**HDB ≠ ADB。**
HDB/HiSuite 只能传文件；Codex 自动安装、日志、截图需要 **USB 调试（ADB）**。

### 打开开发者选项
1. 设置 → 关于平板
2. 连续点击 **版本号 / 编译编号** 7 次，直到提示已处于开发者模式
3. 返回 设置 → 系统和更新 → **开发人员选项**
4. 打开：
   - **USB 调试**（必须）
   - （可选）仅充电模式下允许 ADB 调试
   - HDB 仅 HiSuite 需要，不能替代 USB 调试

### 连接电脑
1. USB 线连接电脑
2. 通知栏选择 **传输文件（MTP）** 或 **仅充电 + USB 调试**
3. 平板弹出 RSA 授权时点 **允许**
4. 电脑验证：

```powershell
adb devices
```

应看到 `device`（不是 `unauthorized` / 空列表）。

### 安装 APK
- 有 ADB：`adb install -r 实验室管理系统-Rental-System-debug.apk`
- 无 ADB：把 APK 拷到「下载」目录，用文件管理器安装（需允许未知来源）

## 6. APK 内实时刷新

- 预约管理频道：`reservations:admin`
- 聊天频道：`chat:<conversationId>`
- WebSocket 地址由运行时服务器地址推导：`ws(s)://host/api/v5/ws`

手机能访问后端、且 CORS 包含 `https://localhost` 时，预约与聊天可在 APK 实时更新。

## 7. 多设备 / 多用户使用建议

- 一个通用 APK + 登录页配置服务器地址
- 生产优先使用 HTTPS 域名，不要把局域网 IP 写死进包
- 多组织隔离后续需要 `tenant_id` / 组织绑定；当前账号体系按角色权限区分

## 8. 安全服务器配对的 HTTPS 限制

扫码配对是导入服务器地址的辅助流程，不是登录或管理员授权流程。二维码中不会包含管理员密码、数据库密码、JWT 密钥、`APP_PAIRING_SECRET` 或任何固定解密密钥；短期配对令牌仅用于与对应服务器兑换公开配置，兑换后用户仍需使用自己的账号和密码登录。

只有在服务端同时满足以下条件时，`/download` 才会显示 App 配对二维码：

- `APP_PUBLIC_URL` 为标准 HTTPS 地址，例如 `https://lab.example.com`；
- 外部 HTTPS 入口使用默认 **443** 端口，不使用 `:8443` 等非标准端口；
- 服务端已配置非空 `APP_PAIRING_SECRET`，且该秘密只保存在服务器环境变量中。

IP/HTTP 安装、证书申请失败或非 443 HTTPS 入口仍可访问网页版，也可让 App 在登录页手动输入服务器地址；但下载页不会提供二维码，且 Android 安全配对不会接受这类地址。请勿尝试通过修改二维码、内置固定密钥或放宽明文网络策略来绕过限制。

### 将 IP/HTTP 部署升级为扫码配对

1. 为服务器配置可访问的域名并完成 DNS 解析。
2. 为域名启用有效 HTTPS 证书，并通过 443 端口提供服务。
3. 在服务器 `.env` 中把 `APP_PUBLIC_URL` 设为不含路径和端口的 HTTPS 原点，例如 `https://lab.example.com`。
4. 在同一服务器 `.env` 中配置高强度随机 `APP_PAIRING_SECRET`；不要把它复制到 APK、前端、二维码、GitHub、Release 或日志。
5. 重启服务后重新打开 `/download`，再用 App 扫描新生成的短期二维码；二维码过期时刷新下载页重新生成。

在 HTTPS 迁移完成前，使用 App 登录页的手动服务器地址输入作为后备方案即可。