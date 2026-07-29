# VPS 安装、管理与升级说明

本文适用于 Ubuntu 22.04 / 24.04。默认目录：

- 源码：`/var/www/laboratory-management-system-src`
- 运行目录：`/var/www/laboratory-management-system/current`
- 共享配置：`/var/www/laboratory-management-system/shared`
- 上传文件：`/var/www/laboratory-management-system/uploads`
- 备份：`/var/www/laboratory-management-system/backups`

## 一键安装

使用具有 `sudo` 权限的账号执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)
```

安装向导会完成 Node.js 22、Nginx、PostgreSQL、前后端构建、数据库迁移、systemd 服务、每日备份、VPS 管理面板和升级命令的配置。

### 域名

域名可以留空：

- 输入域名：可选择自动申请 Let's Encrypt HTTPS 证书；
- 留空：自动检测服务器 IP，使用 `http://服务器IP`；
- 域名申请证书失败：安装不会删除数据，会继续使用 HTTP，并输出手动执行的 Certbot 命令。

### 最高管理员

全新安装默认使用最高管理员账号 `13900000000`，并随机生成形如 `IDBS!...` 的强临时密码。向导允许修改账号、姓名，或输入 12–128 位自定义临时密码。

安装成功会输出：

```text
App 服务器连接地址：https://lab.example.com
网页访问地址：https://lab.example.com/
最高管理员账号：13900000000
最高管理员临时密码：IDBS!随机强密码
VPS 管理面板：sudo db
升级命令：sudo laboratory-management-system-update
```

初始和面板重置后的密码都标记为临时密码。最高管理员登录后只能先完成强制改密，再继续使用受保护功能。

如果安装在初始化过程中中断，临时凭据保存在：

```text
/var/www/laboratory-management-system/shared/.initial-super-admin-pending
```

重新运行安装命令会继续未完成的初始化。成功后，该恢复文件会删除，信息转存到：

```text
/var/www/laboratory-management-system/shared/install-info
```

两个文件都应保持 `root:root`、权限 `600`。可检查：

```bash
sudo stat -c '%U:%G %a %n' \
  /var/www/laboratory-management-system/shared/install-info
```

> 安全警告：即使文件仅 root 可读，明文临时密码仍有风险。不要把临时密码复制到聊天、工单、截图、Shell 历史或普通日志；首次登录后立即修改。

## VPS 管理面板

安装后执行：

```bash
sudo db
```

菜单：

1. 查看 App 服务器连接地址、网页地址、最高管理员账号和最近生成的临时密码；
2. 重置最高管理员账号密码，可直接采用随机强临时密码或输入自定义密码；
3. 退出。

如果第 2 项修改了最高管理员账号，面板会再次确认身份转移。重置成功后会更新 root-only 安装信息，并强制该账号下次登录改密。用户在网页中改密后，面板保存的“最近生成的临时密码”可能已失效，这是正常现象。

## App 与网页连接

- App 登录页填写安装结果中的“App 服务器连接地址”；
- 浏览器打开“网页访问地址”；
- 域名通常使用 HTTPS；IP 模式通常使用 HTTP；
- APK WebView 来源为 `https://localhost`，安装器会把它保留在 `CORS_ORIGIN` 中。

检查服务：

```bash
sudo systemctl status laboratory_management_system
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
```

查看日志：

```bash
sudo journalctl -u laboratory_management_system -f
```

## 导出表格

后台导出的 CSV 文件保存在：

```text
/var/www/laboratory-management-system/uploads/exports
```

导出文件默认保留 7 天。该目录包含业务数据，Nginx 会拒绝直接访问 `/uploads/exports/`，不能通过猜测文件 URL 下载。

正确下载方式：

1. 最高管理员或具备导出权限的管理员进入后台“导出中心”；
2. 创建导出任务并等待完成；
3. 点击下载；
4. 系统通过带登录鉴权的 `/api/v5/admin/export-jobs/:id/download` 返回文件。

升级前的上传文件备份会排除 `uploads/exports`，因为这些文件有 7 天生命周期且可重新生成。数据库中的导出任务记录仍包含在 PostgreSQL 备份中。

## 升级

安装器统一创建以下升级命令：

```bash
sudo laboratory-management-system-update
```

升级过程会：

1. 获取独占升级锁，避免并发升级；
2. 备份 PostgreSQL，并用 `gzip -t` 校验压缩文件；
3. 备份上传目录（排除可重新生成的导出 CSV）；
4. 从 GitHub 获取 `main` 最新代码或指定标签；
5. 安装依赖、构建前端、执行未应用的数据库迁移；
6. 重启服务并检查 `/ready`。

升级到指定标签：

```bash
sudo env RELEASE_REF=v5.0.5 laboratory-management-system-update
```

升级备份位置：

```text
/var/www/laboratory-management-system/backups
```

升级后检查：

```bash
sudo systemctl status laboratory_management_system --no-pager
curl -fsS http://127.0.0.1:3000/ready
sudo journalctl -u laboratory_management_system -n 100 --no-pager
```

如果升级失败，不要删除备份。先记录日志和当前提交：

```bash
git -C /var/www/laboratory-management-system-src rev-parse HEAD
sudo ls -lh /var/www/laboratory-management-system/backups
```

数据库恢复会覆盖业务数据，应在维护窗口由管理员确认备份时间后执行；不要把未核对的备份直接恢复到生产库。

## 自定义目录或分支

需要自定义时，可在首次安装前设置：

```bash
APP_BASE=/srv/lab-system \
SRC_DIR=/srv/lab-system-src \
BRANCH=main \
bash scripts/install-vps.sh
```

安装生成的 `sudo db` 和 `sudo laboratory-management-system-update` 会记录对应的实际目录。