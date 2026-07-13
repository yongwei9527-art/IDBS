# Rental System 大升级完整计划

> **Historical record.** Current IDBS 5.0 release material is [v5-release.md](./v5-release.md) and [v5-api-contract.md](./v5-api-contract.md).

本文档用于指导项目从当前可用版本升级为可长期维护的设备预约与管理系统。升级范围覆盖登录入口、用户端、后台管理端、超级管理员数据分析、数据库模型、接口、权限、安全、部署和验收。

## 1. 升级目标

### 1.1 总体目标

- 用户可以清楚完成注册、登录、查看设备、发起多天多设备预约、查看日历、使用设备、归还设备、报备故障。
- 管理员可以审核用户、审核预约、管理设备、处理故障、查看日历、导出统计。
- 超级管理员可以看到全局运营数据、设备使用分析图、故障趋势、预约通过率、用户活跃情况，并管理其他管理员权限。
- 数据库支持长期扩展，尤其支持多设备、多日期、多时间段、部分审批、日历查询和统计分析。
- 前后端代码从“能跑”升级为“清晰分层、便于维护、便于部署”。

### 1.2 设计原则

- 登录优先：未登录只能看到登录入口，登录后根据身份进入对应页面。
- 权限优先：前端隐藏只是体验，后端接口必须校验权限。
- 数据优先：预约、日历、统计都以结构化数据库为准，不能靠前端临时拼接。
- 用户少填：预约用选择器和日历，不让用户手写复杂时间。
- 管理员少猜：后台要把待处理事项、冲突原因、设备状态和权限含义直接展示出来。
- 可回退：每个阶段都要能提交 Git、跑检查、保留迁移脚本。

## 2. 登录与入口设计

### 2.1 访问规则

| 场景 | 结果 |
| --- | --- |
| 未登录访问任意业务页 | 自动跳转 `login.html` |
| 普通用户登录成功 | 进入用户端首页 `index.html` |
| 管理员账号登录成功 | 默认仍进入用户端首页，但显示“进入后台”入口 |
| 普通用户访问后台 | 显示无权限提示，并提供返回用户端按钮 |
| 管理员访问后台 | 根据权限显示对应模块 |
| 超级管理员访问后台 | 显示全部模块和数据分析中心 |

### 2.2 登录页布局

登录页分为三块：

```text
顶部：系统名称、简短说明
中部：登录卡片
底部：使用说明、管理员入口说明
```

登录卡片包含：

- 手机号密码登录。
- 微信公众号验证码登录。
- 新用户绑定入口。
- 登录注意事项弹窗。
- 本地测试账号提示，仅本地环境显示。

### 2.3 登录后导航

普通用户导航：

```text
设备列表
发起预约
使用日历
我的记录
故障报备
退出登录
```

管理员用户导航：

```text
设备列表
发起预约
使用日历
我的记录
进入后台
退出登录
```

超级管理员后台导航：

```text
后台总览
数据分析
设备管理
预约审核
用户审核
故障报备
使用日历
统计导出
管理员权限
系统配置
操作日志
```

## 3. 用户端大升级

### 3.1 用户端整体布局

建议采用“顶部导航 + 内容卡片 + 右侧状态摘要”的布局。

桌面端：

```text
顶部导航
主内容区：设备、预约、日历、记录
右侧摘要：当前身份、待审核预约、使用中设备、故障提醒
```

移动端：

```text
顶部系统栏
底部 Tab 导航
内容卡片单列展示
```

底部 Tab：

```text
设备
预约
日历
我的
```

### 3.2 设备列表页

功能：

- 搜索设备编号、名称、位置、负责人。
- 分类下拉筛选。
- 状态筛选：可预约、已预约、使用中、故障、维修、停用。
- 显示今日可用时间段。
- 显示设备预约热度。
- 显示故障标记。
- 点击进入详情。

设备卡片字段：

```text
设备编号
设备名称
类别
位置
负责人
当前状态
可预约时间段
今日占用情况
设备图片
按钮：查看详情、立即预约
```

状态颜色：

| 状态 | 颜色 |
| --- | --- |
| 可预约 | 绿色 |
| 已预约 | 蓝色 |
| 使用中 | 橙色 |
| 故障待处理 | 红色 |
| 维修中 | 紫灰色 |
| 停用 | 灰色 |

### 3.3 设备详情页

详情页模块：

- 设备基础信息。
- 设备图片。
- 设备说明。
- 使用注意事项。
- 可预约时间段。
- 近 14 天占用情况。
- 近期故障记录，普通用户只看状态摘要。
- 发起预约按钮。

故障设备显示：

```text
当前设备故障或维修中，暂不可预约。
```

### 3.4 发起预约页

这是用户端核心升级。

支持一次提交多组预约计划。

页面结构：

```text
发起预约

预约计划 1
- 选择设备：支持搜索、下拉、多选
- 选择日期：日历多选
- 选择时间段：上午、下午、晚上、夜间、白天、自定义
- 使用目的
- 按钮：检查冲突、删除本组

预约计划 2
- 同上

底部：
- 添加一组预约计划
- 预览预约明细
- 提交预约
```

示例：

```text
计划 1：
17、19、20 号上午使用设备 A、B

计划 2：
18、21 号下午使用设备 A、C
```

提交前预览：

```text
本次将生成 10 条预约明细：
A：17 上午、19 上午、20 上午、18 下午、21 下午
B：17 上午、19 上午、20 上午
C：18 下午、21 下午
```

冲突提示：

```text
设备 A 在 2026-07-17 08:00-12:00 已被预约。
设备 C 在 2026-07-21 12:00-17:00 当前维修中。
```

### 3.5 用户使用日历

日历必须始终存在，即使没有预约。

月视图规则：

- 固定显示完整月份。
- 没有预约的日期显示为空白日期格。
- 有预约的日期显示设备颜色标签。
- 同一天多个设备显示多条标签。
- 超过格子容量显示“还有 N 条”。
- 鼠标悬停显示当天局部详情。
- 点击日期进入详情页。

普通用户可见范围：

| 信息 | 自己的预约 | 别人的预约 |
| --- | --- | --- |
| 设备 | 可见 | 可见 |
| 时间段 | 可见 | 可见 |
| 预约人姓名 | 可见 | 根据系统配置 |
| 手机号 | 可见 | 默认隐藏 |
| 学号 | 可见 | 默认隐藏 |
| 使用目的 | 可见 | 隐藏 |

### 3.6 我的记录页

分 Tab：

```text
待审核
已通过
使用中
已完成
已拒绝
已取消
故障报备
```

每条记录显示：

- 预约批次号。
- 设备。
- 日期。
- 时间段。
- 状态。
- 审批备注。
- 开始使用。
- 归还设备。
- 报备故障。
- 取消预约。

### 3.7 用户故障报备

入口：

- 使用中记录里报备。
- 设备详情页报备。
- 我的记录里报备。

字段：

```text
设备
当前使用记录
故障类型
故障等级
故障描述
上传图片
是否影响继续使用
```

提交后动作：

- 生成故障报备。
- 设备状态改为 `abnormal_pending`。
- 设备停止接受新预约。
- 后台异常设备数量增加。
- 写入操作日志。

## 4. 后台管理端大升级

### 4.1 后台总体布局

后台采用：

```text
顶部：系统标题、当前管理员、快捷操作
左侧：模块导航
中间：当前模块内容
右侧或顶部：数据摘要卡片
```

左侧导航：

```text
后台总览
数据分析
设备管理
预约审核
用户审核
故障报备
使用日历
统计导出
管理员权限
系统配置
操作日志
```

权限控制：

- 无权限模块不显示。
- 直接访问无权限模块时显示无权限页面。
- 接口层再次校验权限。

### 4.2 后台总览

顶部 KPI 卡片：

```text
设备总数
可预约设备
使用中设备
异常设备
待审核用户
待审核预约
今日预约
本周使用次数
```

卡片可点击：

- 异常设备 -> 故障报备列表。
- 待审核预约 -> 预约审核。
- 待审核用户 -> 用户审核。
- 使用中设备 -> 当前使用列表。

### 4.3 超级管理员数据分析中心

仅超级管理员或拥有 `stats.view` 权限的人可查看。

#### 4.3.1 设备使用趋势图

图表：折线图。

指标：

- 每日预约次数。
- 每日实际使用次数。
- 每日归还次数。
- 每日故障次数。

筛选：

```text
近 7 天
近 30 天
本月
自定义日期范围
```

#### 4.3.2 设备使用排行

图表：横向柱状图。

展示：

```text
设备 A：使用 35 次
设备 B：使用 28 次
设备 C：使用 12 次
```

可切换：

- 按预约次数。
- 按实际使用次数。
- 按使用小时数。
- 按故障次数。

#### 4.3.3 设备状态分布

图表：环形图。

分类：

```text
可预约
已预约
使用中
故障待处理
维修中
停用
```

#### 4.3.4 时间段使用热力图

图表：热力图。

横轴：

```text
周一 到 周日
```

纵轴：

```text
上午
下午
晚上
夜间
白天
```

用途：

- 发现哪些时间段最热门。
- 判断是否需要增加设备或限制预约。

#### 4.3.5 预约审批分析

图表：堆叠柱状图。

指标：

- 待审核数量。
- 通过数量。
- 拒绝数量。
- 取消数量。
- 过期未使用数量。

#### 4.3.6 用户活跃分析

图表：折线图 + 排行榜。

指标：

- 日活跃用户数。
- 新注册用户数。
- 被审核通过用户数。
- 使用次数最多用户。
- 预约次数最多用户。

隐私规则：

- 超级管理员可看完整信息。
- 普通统计权限管理员只看脱敏数据。

#### 4.3.7 故障趋势分析

图表：

- 故障数量趋势折线图。
- 故障类型饼图。
- 故障设备排行。

字段：

```text
故障类型
故障等级
处理耗时
是否恢复
处理人
```

#### 4.3.8 数据导出

支持导出：

- 预约记录。
- 使用记录。
- 故障记录。
- 用户活跃记录。
- 设备使用汇总。

格式：

- CSV，第一阶段实现。
- Excel，第二阶段实现。

### 4.4 设备管理

功能：

- 新增设备。
- 编辑设备。
- 删除或停用设备。
- 上传设备照片。
- 设置设备说明。
- 设置使用注意事项。
- 配置可预约时间段。
- 查看设备预约历史。
- 查看设备故障历史。

设备时间段配置：

```text
上午：08:00-12:00
下午：12:00-17:00
晚上：17:00-22:00
夜间：22:00-次日 08:00
白天：08:00-22:00
自定义：管理员填写开始和结束时间
```

### 4.5 预约审核

分为批次和明细。

批次列表：

```text
用户
提交时间
设备数量
日期数量
明细数量
状态
操作
```

批次详情：

```text
设备
日期
时间段
冲突状态
审批状态
操作
```

操作：

- 整批通过。
- 整批拒绝。
- 单条通过。
- 单条拒绝。
- 填写审批备注。

### 4.6 使用日历后台版

后台日历信息更多。

显示：

- 设备颜色标签。
- 使用人。
- 手机号或学号。
- 状态。
- 审批情况。
- 故障标记。

筛选：

```text
设备
用户
状态
日期范围
只看故障
只看待审核
```

点击日期详情：

```text
设备 A
08:00-12:00
预约人：张三
状态：已通过
操作：查看预约、查看用户、处理异常
```

### 4.7 故障报备管理

状态流转：

```text
待处理 -> 处理中 -> 已解决
待处理 -> 已关闭
处理中 -> 已关闭
```

管理员操作：

- 查看故障详情。
- 查看图片。
- 标记处理中。
- 填写处理备注。
- 恢复设备为可预约。
- 保持设备维修中。
- 关闭报备。

设备状态联动：

| 故障状态 | 设备状态 |
| --- | --- |
| 用户提交故障 | abnormal_pending |
| 管理员处理中 | maintenance |
| 解决并恢复 | available |
| 解决但不恢复 | maintenance 或 disabled |

### 4.8 用户管理

模块：

- 用户审核。
- 用户搜索。
- 用户禁用。
- 用户恢复。
- 解绑微信 OpenID。
- 查看用户预约历史。
- 查看用户使用历史。
- 查看用户故障报备。

用户详情页：

```text
基础资料
注册时间
最近登录
预约次数
实际使用次数
故障报备次数
当前状态
管理员备注
```

### 4.9 管理员权限

权限页布局：

```text
选择用户
选择权限模板
勾选具体权限
备注
保存授权
当前管理员列表
```

权限模板：

```text
超级管理员：全部权限
管理员：设备、用户、预约、统计
运营：设备、预约、故障
审计：查看、导出
```

权限项：

```text
user.approve       同意用户注册
user.manage        管理用户
reservation.view   查看预约
reservation.approve 同意用户预约
device.view        查看设备
device.manage      管理设备
fault.manage       处理故障报备
stats.view         查看统计
stats.export       导出统计
system.config      系统配置
admin.manage       管理管理员权限
operation.view     查看操作日志
```

## 5. 数据库升级

### 5.1 核心表结构

#### users

新增建议字段：

```sql
avatar_url TEXT,
department TEXT,
last_active_at TIMESTAMPTZ,
disabled_reason TEXT,
approved_by UUID,
approved_at TIMESTAMPTZ
```

#### devices

继续保留核心字段，增加规范状态。

状态：

```text
available
reserved
in_use
abnormal_pending
maintenance
disabled
```

#### device_time_slots

```sql
CREATE TABLE device_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,
  label TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  crosses_day BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(device_id, slot_key)
);
```

#### reservation_batches

```sql
CREATE TABLE reservation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  submit_note TEXT,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### reservation_items

```sql
CREATE TABLE reservation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES reservation_batches(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reservation_date DATE NOT NULL,
  slot_key TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
```

防冲突约束：

```sql
ALTER TABLE reservation_items
ADD CONSTRAINT reservation_items_no_overlap_active
EXCLUDE USING gist (
  device_id WITH =,
  tstzrange(start_time, end_time, '[)') WITH &&
)
WHERE (status IN ('pending','approved','in_use'));
```

#### borrow_records

新增：

```sql
reservation_item_id UUID REFERENCES reservation_items(id) ON DELETE SET NULL,
actual_start_time TIMESTAMPTZ,
actual_end_time TIMESTAMPTZ
```

#### device_fault_reports

```sql
severity TEXT DEFAULT 'normal',
handled_by UUID REFERENCES users(id) ON DELETE SET NULL,
handled_at TIMESTAMPTZ,
reservation_item_id UUID REFERENCES reservation_items(id) ON DELETE SET NULL
```

#### permissions

```sql
CREATE TABLE permissions (
  permission_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  group_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
```

#### roles

```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### role_permissions

```sql
CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_key)
);
```

#### user_roles

```sql
CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, role_id)
);
```

#### operation_logs

```sql
CREATE TABLE operation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  operator_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.2 数据库视图

#### calendar_events_view

用于日历快速查询。

字段：

```text
event_id
device_id
device_code
device_name
user_id
user_name
start_time
end_time
status
source_type
color_key
```

#### device_usage_summary_view

用于超级管理员数据分析。

字段：

```text
device_id
device_code
device_name
reservation_count
borrow_count
total_minutes
fault_count
last_used_at
```

## 6. 后端接口升级

### 6.1 用户端接口

```text
GET  /api/devices
GET  /api/devices/:deviceCode
GET  /api/device-time-slots?device_id=
POST /api/reservation-batches
GET  /api/reservation-batches/me
GET  /api/reservation-batches/:id
PATCH /api/reservation-items/:id/cancel
GET  /api/calendar
GET  /api/calendar/days/:date
POST /api/fault-reports
GET  /api/fault-reports/me
```

### 6.2 后台接口

```text
GET   /api/admin/dashboard
GET   /api/admin/analytics/overview
GET   /api/admin/analytics/device-usage
GET   /api/admin/analytics/time-heatmap
GET   /api/admin/analytics/faults
GET   /api/admin/reservation-batches
GET   /api/admin/reservation-batches/:id
PATCH /api/admin/reservation-items/:id/approval
PATCH /api/admin/reservation-batches/:id/approval
GET   /api/admin/fault-reports
PATCH /api/admin/fault-reports/:id
GET   /api/admin/permissions
PUT   /api/admin/user-roles
GET   /api/admin/operation-logs
```

## 7. 前端模块化

建议逐步拆成：

```text
public/js/components/calendar.js
public/js/components/permission-picker.js
public/js/components/device-selector.js
public/js/components/date-multi-picker.js
public/js/components/time-slot-picker.js
public/js/components/stat-chart.js
public/js/pages/login-page.js
public/js/pages/index-page.js
public/js/pages/reserve-page.js
public/js/pages/admin-page.js
public/js/pages/analytics-page.js
```

图表建议：

- 第一阶段用原生 SVG 或 Canvas，避免引入复杂依赖。
- 第二阶段可引入 ECharts，做趋势图、柱状图、热力图、饼图。

## 8. 开发里程碑

### 阶段 0：整理当前版本

- 跑 `npm run check`。
- 跑 `npm run smoke`。
- 提交当前 Git 改动。
- 推送 GitHub。
- 备份本地数据库。

### 阶段 1：数据库升级

- 新建 migration。
- 创建 `device_time_slots`。
- 创建 `reservation_items`。
- 创建权限相关表。
- 创建统计视图。
- 写数据迁移脚本。

### 阶段 2：预约核心升级

- 后端支持多组预约计划。
- 后端展开预约明细。
- 后端检查冲突。
- 用户预约页升级。
- 后台预约审核升级。

### 阶段 3：日历升级

- 后端提供统一日历接口。
- 用户日历固定月视图。
- 后台日历支持筛选。
- 日期详情页升级。

### 阶段 4：故障报备升级

- 用户故障报备。
- 设备状态联动。
- 后台故障处理。
- 故障分析图。

### 阶段 5：超级管理员分析中心

- 后台总览 KPI。
- 设备使用趋势图。
- 设备排行图。
- 时间段热力图。
- 故障趋势图。
- 用户活跃分析。

### 阶段 6：权限系统升级

- 权限表和角色表落地。
- 后台权限页升级。
- 所有后台接口接入权限校验。
- 操作日志记录权限变更。

### 阶段 7：上线部署

- 本地检查。
- 本地迁移数据库。
- GitHub 同步。
- VPS 拉取代码。
- VPS 执行 migration。
- 重启服务。
- 浏览器验收。

## 9. 验收清单

### 用户端

- 未登录不能进入业务页。
- 普通用户登录后看不到后台管理。
- 用户可以搜索设备。
- 用户可以一次预约多设备、多日期、多时间段。
- 冲突时能看到具体冲突原因。
- 用户日历无预约时也显示完整月份。
- 用户可以查看自己的预约详情。
- 用户可以在使用中报备故障。

### 后台端

- 管理员可以审核用户。
- 管理员可以审核预约批次。
- 管理员可以单条通过或拒绝预约明细。
- 管理员可以处理故障。
- 管理员可以配置设备时间段。
- 无权限管理员看不到无权模块。
- 后端接口会拒绝无权限请求。

### 超级管理员

- 可以看到全部后台模块。
- 可以查看设备使用趋势图。
- 可以查看设备使用排行。
- 可以查看时间段热力图。
- 可以查看故障趋势。
- 可以导出指定时间段统计。
- 可以授权或撤销其他管理员权限。
- 权限修改有操作日志。

### 数据库

- 同一设备同一时间不能重复预约。
- 多设备多日期会生成多条预约明细。
- 故障报备会联动设备状态。
- 统计接口能按时间范围查询。
- migration 可重复执行或安全失败。

## 10. 风险与注意事项

- 大升级前必须先提交当前版本，否则问题难以回退。
- 预约模型升级会影响最多页面，应最先设计清楚。
- 日历显示必须依赖后端统一接口，不能每个页面单独拼。
- 权限必须以后端为准，不能只隐藏前端按钮。
- 数据库 migration 上 VPS 前，必须先在本地验证。
- 图表功能不要第一天就做复杂，先把数据接口和基础图表跑通。

## 11. 推荐下一步

下一步建议先执行：

```text
1. 整理并提交当前工作区
2. 新建数据库 migration：预约明细、设备时间段、权限表
3. 实现新版预约提交接口
4. 改造用户预约页
5. 改造后台预约审核页
```

完成这五步后，系统的核心业务模型就稳定了，再继续做日历、故障、图表和超级管理员分析中心会顺很多。
