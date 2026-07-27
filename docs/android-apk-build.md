# Android APK Build Guide

本项目使用 Capacitor 将 Vite/React 前端打包为 Android APK。APK 内是静态前端；Node.js + PostgreSQL 后端仍需部署在可访问的服务器上。

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
