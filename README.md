# 实验室管理系统

面向实验室的设备预约、借还、故障、群聊、通知和后台管理系统。

当前版本：**v5.0.8**
全新 VPS 支持：Ubuntu 22.04 / 24.04、Debian 12 / 13、Web、PWA、Android。旧系统上的已有安装只提供恢复兼容模式，恢复后必须尽快迁移到支持的系统。

## 一键安装

在受支持的全新 Ubuntu/Debian VPS 中执行：

```bash
tmp="$(mktemp)"
curl -4fL --connect-timeout 15 --max-time 120 --retry 3 \
  -o "$tmp" \
  "https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install.sh?v=$(date +%s)"
sudo bash "$tmp"
rm -f "$tmp"
```

安装器会询问域名、HTTPS、最高管理员账号、密码和数据目录。直接按 Enter 可采用安全默认值；随机管理员密码只显示一次。

如果 VPS 无法连接 GitHub，可明确选择第三方代理（代理不由本项目运营，请确认信任后使用）：

```bash
tmp="$(mktemp)"
curl -4fL --connect-timeout 15 --max-time 120 --retry 3 \
  -o "$tmp" \
  "https://ghproxy.net/https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install.sh?v=$(date +%s)"
sudo env GITHUB_PROXY_PREFIX=https://ghproxy.net bash "$tmp"
rm -f "$tmp"
```

也可将命令中的两个 `ghproxy.net` 同时替换为 `gh-proxy.com` 或 `github.akams.cn`。

安装完成后会输出：

```text
系统地址：https://你的域名/v5/
后台地址：https://你的域名/v5/admin
App 下载：https://你的域名/download
最高管理员账号：13900000000
最高管理员临时密码：随机生成
```

没有域名也能安装，系统会使用服务器公网 IP 和 HTTP。安装器会同时验证 Node 内部 `/ready` 与 Nginx 公共路由；`127.0.0.1:3000` 仅是服务器内部检查地址。生产环境推荐使用域名和 HTTPS。

全新安装固定使用 PostgreSQL 16，不再随发行版随机安装 PostgreSQL 13/15。安装前还会拒绝非 systemd 主机、并发部署、非本项目进程占用运行端口，以及非 Nginx 程序占用 80/443 端口。

## 常用命令

```bash
# 查看或重置最高管理员账号
sudo db

# 更新到最新版（自动先备份）
sudo laboratory-management-system-update

# 查看服务状态
sudo systemctl status laboratory-management-system

# 查看日志
sudo journalctl -u laboratory-management-system -f

# 手动备份
sudo laboratory-management-system-backup

# PostgreSQL 13 主版本升级到项目验证过的 PostgreSQL 16
sudo laboratory-management-system-upgrade-postgresql
```

PostgreSQL 主版本升级会要求输入 `UPGRADE-POSTGRESQL` 二次确认，先生成并验证数据库与全局角色备份，再执行升级。升级到 16 后会再次验证数据库版本、应用 `/ready`（已有服务正在运行时）以及由 PostgreSQL 16 工具生成的第二份备份；全部通过才删除旧集群并精确卸载旧主版本软件包，不执行 `autoremove`。安装器发现本项目本地数据库仍为 PostgreSQL 13/14/15 时会自动完成相同的替换流程。完整流程和首次安装尚未成功时的独立升级命令见 VPS 详细文档。

## 使用入口

- 网页：`https://你的域名/v5/`
- 后台：`https://你的域名/v5/admin`
- App 下载：`https://你的域名/download`
- 健康检查：`https://你的域名/health`

Android App 可扫码导入服务器地址，也可在登录页手动输入域名或 IP。最高管理员密码不会写入 App 或二维码。

## 更新与卸载

更新：

```bash
sudo laboratory-management-system-update
```

卸载程序但保留业务数据：

```bash
curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/uninstall-vps.sh | sudo bash
```

完整删除数据库、上传文件和备份属于危险操作，必须按照详细文档执行。

## 主要功能

- 设备预约、审批、借出、归还和故障处理
- 用户审核、批准码、角色和权限管理
- 实验室总群、群公告、历史公告和新成员公告弹窗
- Web、PWA、Android App 与扫码配置服务器
- 表格导出、旧数据导入、备份和恢复
- HTTPS、会话撤销、审计日志和安全更新
- 可选 Firebase Android 后台通知

## 下载与文档

- [GitHub Releases](https://github.com/yongwei9527-art/IDBS/releases)
- [VPS 详细安装与维护](./docs/VPS_DEPLOYMENT.md)
- [v5.0.8 发布说明](./docs/RELEASE-v5.0.8.md)
- [Android APK 构建与签名](./docs/android-apk-build.md)
- [API 接口说明](./docs/v5-api-contract.md)
- [免责声明](./DISCLAIMER.md)

首次登录后请立即修改最高管理员临时密码，并妥善保存数据库、上传文件和导出文件的离线备份。
