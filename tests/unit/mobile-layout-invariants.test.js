const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const layoutSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/layout/app-layout.tsx'), 'utf8');
const visualCss = fs.readFileSync(path.resolve(__dirname, '../../web/src/styles/visual-system.css'), 'utf8');
const calendarSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/reservation/calendar-page.tsx'), 'utf8');
const reserveSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/reservation/reserve-page.tsx'), 'utf8');
const chatDetailSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/chat/chat-detail-page.tsx'), 'utf8');
const nativeNotificationsSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/notification/native-notifications.ts'), 'utf8');
const nativeRuntimePluginSource = fs.readFileSync(path.resolve(__dirname, '../../web/android/app/src/main/java/com/laboratory/managementsystem/NativeRuntimePlugin.java'), 'utf8');

test('APK drawer has backdrop, explicit close control, navigation close, and hardware back handling', () => {
  assert.match(layoutSource, /!collapsed && drawerSurface/);
  assert.doesNotMatch(layoutSource, /bg-slate-950\/20 md:hidden/);
  assert.match(layoutSource, /id="app-navigation"/);
  assert.match(layoutSource, /onClick=\{closeNavigation\}/);
  assert.match(layoutSource, /handleNavigationClick\(event, item\.to\)/);
  assert.match(layoutSource, /CapacitorApp\.addListener\('backButton'/);
});

test('drawer lock is released and APK page remains a vertical touch scroller', () => {
  assert.match(layoutSource, /document\.body\.style\.overflow = previousBodyOverflow/);
  assert.match(layoutSource, /delete document\.documentElement\.dataset\.navigationOpen/);
  assert.match(visualCss, /\.ops-page-area \{[\s\S]*min-height: 0 !important;[\s\S]*overflow-y: auto !important;[\s\S]*touch-action: pan-y;/);
  assert.match(visualCss, /\[data-navigation-open="true"\] \.ops-page-area \{[\s\S]*overflow-y: hidden !important;/);
  assert.match(visualCss, /\.ops-sidebar-nav \{[\s\S]*touch-action: pan-y;/);
});

test('APK media and charts are constrained to the visible content width', () => {
  assert.match(visualCss, /\.ops-main img,[\s\S]*max-width: 100%;[\s\S]*object-fit: contain;/);
  assert.match(visualCss, /\.recharts-responsive-container,[\s\S]*max-width: 100% !important;[\s\S]*max-height: min\(56dvh, 28rem\);/);
});
test('reservation device selection uses a bounded scrollable dropdown without oversized aspect placeholders', () => {
  assert.doesNotMatch(reserveSource, /aspect-\[4\/3\]/);
  assert.match(reserveSource, /id="reservation-device-options"/);
  assert.match(reserveSource, /max-h-80/);
  assert.match(reserveSource, /overflow-y-auto/);
});
test('APK calendar uses a viewport-width grid without a forced horizontal canvas', () => {
  assert.doesNotMatch(calendarSource, /min-w-\[980px\]/);
  assert.match(calendarSource, /calendar-grid min-w-0 w-full/);
  assert.match(calendarSource, /calendar-event-time/);
  assert.match(visualCss, /\.calendar-board \{[\s\S]*overflow-x: hidden !important;[\s\S]*touch-action: pan-y;/);
  assert.match(visualCss, /@media \(max-width: 767px\)[\s\S]*\.calendar-event-time \{[\s\S]*display: none;/);
});
test('night approval workspace uses dark semantic surfaces instead of hard-coded white panels', () => {
  assert.match(visualCss, /:root\[data-ambient="night"\] \.approval-batch-card,[\s\S]*background: var\(--surface-raised\) !important;/);
  assert.match(visualCss, /:root\[data-ambient="night"\] \.approval-batch-card--active[\s\S]*background: hsl\(var\(--primary\) \/ \.16\) !important;/);
  assert.match(visualCss, /:root\[data-ambient="night"\] \.approval-risk-strip[\s\S]*background: rgb\(216 150 20 \/ \.12\) !important;/);
  assert.match(visualCss, /:root\[data-ambient="night"\] \.approval-risk-item[\s\S]*background: rgb\(255 255 255 \/ \.035\) !important;/);
});
test('short landscape calendar keeps the month module compact without shrinking body text', () => {
  assert.match(visualCss, /@media \(orientation: landscape\) and \(max-height: 720px\)[\s\S]*\.calendar-day-cell \{[\s\S]*min-height: 2\.45rem !important;/);
  assert.match(visualCss, /\.calendar-event-chip,[\s\S]*\.calendar-more-button \{[\s\S]*display: none !important;/);
});

test('tablet landscape APK restores stable CJK font sizing and line height', () => {
  assert.match(visualCss, /@media \(min-width: 768px\) and \(orientation: landscape\) \{/);
  assert.match(visualCss, /text-size-adjust: 100%;/);
  assert.match(visualCss, /\.ops-main \.text-base \{ font-size: 1rem !important; line-height: 1\.45 !important; \}/);
  assert.match(visualCss, /\.ops-layout-shell table td \{[\s\S]*line-height: 1\.45 !important;/);
});

test('APK compact height rules do not collapse min-height chat rows', () => {
  assert.doesNotMatch(visualCss, /\.ops-main \[class\*='min-h-'\]/);
  assert.doesNotMatch(visualCss, /\.ops-main \[class\*='h-16'\]/);
  assert.match(visualCss, /\.ops-main \[class~='h-16'\]/);
});

test('chat detail breadcrumb hides the technical conversation UUID', () => {
  assert.match(layoutSource, /seg\[index - 1\] === 'chat'/);
  assert.match(layoutSource, /return '会话'/);
});

test('APK never registers Firebase push when the installed package has no Firebase configuration', () => {
  assert.match(nativeRuntimePluginSource, /getIdentifier\([\s\S]*"google_app_id"/);
  assert.match(nativeNotificationsSource, /await hasRemotePushConfiguration\(\)/);
  assert.match(nativeNotificationsSource, /当前安装包尚未配置 FCM/);
  assert.match(nativeNotificationsSource, /PushNotifications\.register\(\)/);
});

test('management group entry shows a read-only latest announcement and replaces redundant info', () => {
  assert.ok(chatDetailSource.includes('function LatestAnnouncementDialog'));
  assert.ok(chatDetailSource.includes('setShowLatestAnnouncement(true)'));
  assert.ok(chatDetailSource.includes('latestAnnouncement={announcements.data?.latest}'));
  assert.ok(chatDetailSource.includes('{isManagementGroup ? ('));
  assert.ok(chatDetailSource.includes('latestAnnouncement.content'));
  assert.ok(chatDetailSource.includes('{!isManagementGroup && <div>'));
  assert.ok(chatDetailSource.includes("conversation?.type === 'group' && !isManagementGroup"));
});
