const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const layoutSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/layout/app-layout.tsx'), 'utf8');
const visualCss = fs.readFileSync(path.resolve(__dirname, '../../web/src/styles/visual-system.css'), 'utf8');
const calendarSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/reservation/calendar-page.tsx'), 'utf8');
const reserveSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/reservation/reserve-page.tsx'), 'utf8');

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
test('reservation device photos use a bounded responsive height instead of oversized aspect placeholders', () => {
  assert.doesNotMatch(reserveSource, /aspect-\[4\/3\]/);
  assert.match(reserveSource, /h-32 w-full[\s\S]*sm:h-36 xl:h-40/);
  assert.match(reserveSource, /object-contain/);
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
