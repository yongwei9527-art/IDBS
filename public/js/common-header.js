document.addEventListener('DOMContentLoaded', () => {
  const header = document.createElement('header');
  const page = (window.location.pathname || '').replace(/\\/g, '/').split('/').pop() || 'index.html';
  const params = new URLSearchParams(window.location.search || '');
  const adminMode = page === 'admin.html' || params.get('admin') === '1' || document.body?.classList.contains('admin-page') || document.body?.dataset?.area === 'admin';
  const user = getHeaderUserInfo();
  const loggedIn = typeof isLoggedIn === 'function' ? isLoggedIn() : false;
  const adminLoggedIn = typeof isAdminLoggedIn === 'function' ? isAdminLoggedIn() : false;
  const showAdminEntry = adminLoggedIn;
  const userName = user && user.name ? user.name : '已登录用户';
  const showShellNav = adminMode ? adminLoggedIn : loggedIn;

  const adminItems = [
    { href: 'admin.html#overview', label: '工作台', icon: '⌂', page: 'admin.html', group: '工作区' },
    { href: 'admin.html#analytics', label: '数据分析', icon: '▥', page: 'admin.html', group: '工作区' },
    { href: 'admin.html#devices', label: '设备管理', icon: '▣', page: 'admin.html', group: '业务管理' },
    { href: 'admin.html#reservations', label: '预约审批', icon: '✓', page: 'admin.html', group: '业务管理' },
    { href: 'admin.html#users', label: '用户审核', icon: '◉', page: 'admin.html', group: '业务管理' },
    { href: 'admin.html#faults', label: '故障报备', icon: '◇', page: 'admin.html', group: '业务管理' },
    { href: 'admin.html#requests', label: '需求上报', icon: '✧', page: 'admin.html', group: '业务管理' },
    { href: 'calendar.html?admin=1&back=admin.html%23overview', label: '使用日历', icon: '◷', page: 'calendar.html', group: '业务管理' },
    { href: 'chat.html?admin=1&back=admin.html%23overview', label: '管理聊天', icon: '✉', page: 'chat.html', group: '业务管理' },
    { href: 'admin.html#stats', label: '统计导出 / 注意事项', icon: '↥', page: 'admin.html', group: '系统管理' },
    { href: 'admin.html#roles', label: '管理员权限', icon: '♢', page: 'admin.html', group: '系统管理' },
    { href: 'admin.html#security', label: '系统配置', icon: '⚙', page: 'admin.html', group: '系统管理' },
    { href: 'admin.html#user-info', label: '用户信息', icon: '◌', page: 'admin.html', group: '系统管理' },
    { href: 'admin.html#contacts', label: '联系方式', icon: '☎', page: 'admin.html', group: '系统管理' },
    { href: 'admin.html#logs', label: '操作日志', icon: '☷', page: 'admin.html', group: '系统管理' }
  ];
  const userItems = [
    { href: 'index.html', label: '设备总览', icon: '▦', page: 'index.html', group: '预约服务' },
    { href: 'reserve.html', label: '发起预约', icon: '+', page: 'reserve.html', group: '预约服务' },
    { href: 'my.html', label: '我的预约', icon: '◴', page: 'my.html', group: '预约服务' },
    { href: 'calendar.html', label: '使用日历', icon: '◷', page: 'calendar.html', group: '预约服务' },
    { href: 'chat.html', label: '消息沟通', icon: '✉', page: 'chat.html', group: '预约服务' }
  ];
  const navItems = adminMode ? adminItems : userItems;
  const currentHash = window.location.hash || '#overview';
  const topNavItems = navItems.slice(0, adminMode ? 5 : navItems.length);

  document.body.classList.add(adminMode ? 'admin-area' : 'user-area');
  if (!showShellNav) document.body.classList.add('no-sidebar');

  header.innerHTML = `
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">⚗</div>
      <div>
        <h1>实验室管理系统</h1>
        <p class="brand-subtitle">IDBS</p>
      </div>
    </div>
    ${showShellNav ? '<button class="shell-menu-button" type="button" aria-label="展开导航">☰</button>' : ''}
    <nav class="main-nav" aria-label="主导航">
      ${showShellNav ? topNavItems.map((item) => `<a href="${item.href}" class="${isNavActive(item) ? 'active' : ''}">${item.label}</a>`).join('') : ''}
    </nav>
    <div class="header-spacer"></div>
    <div class="account-nav">
      ${renderAccountNav()}
    </div>
  `;

  document.body.prepend(header);

  if (showShellNav) {
    const sidebar = document.createElement('aside');
    sidebar.className = 'app-sidebar';
    sidebar.innerHTML = `
      <a class="sidebar-brand" href="${adminMode ? 'admin.html#overview' : 'index.html'}" aria-label="返回首页">
        <span class="sidebar-brand-mark">⚗</span>
        <span>
          <strong>实验室管理系统</strong>
          <small>IDBS</small>
        </span>
      </a>
      <nav class="sidebar-nav" aria-label="侧边栏导航">
        ${renderSidebarGroups(navItems)}
      </nav>
      <button class="sidebar-foot staff-contact-trigger" id="staff-contact-trigger" type="button">
        <strong>工作人员联系方式</strong>
        <b>查看二维码 / 电话</b>
      </button>
    `;
    header.after(sidebar);
  }

  document.querySelector('.shell-menu-button')?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });

  document.getElementById('logout-user-link')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (typeof logoutUser === 'function') logoutUser();
    location.replace('login.html');
  });

  document.getElementById('logout-admin-link')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (typeof logoutAdmin === 'function') logoutAdmin();
    location.replace(adminMode ? 'admin.html' : 'index.html');
  });

  document.getElementById('staff-contact-trigger')?.addEventListener('click', () => {
    openStaffContactModal();
  });

  if (!adminMode && page !== 'login.html') showSystemNoticeIfNeeded();

  function isNavActive(item) {
    if (item.page !== page) return false;
    if (page !== 'admin.html') return true;
    const itemHash = item.href.includes('#') ? `#${item.href.split('#')[1]}` : '#overview';
    return itemHash === currentHash || (!window.location.hash && itemHash === '#overview');
  }

  function renderAccountNav() {
    if (adminMode) {
      return adminLoggedIn
        ? '<a class="notification-trigger" href="admin.html#overview" aria-label="通知">🔔</a><span class="account-profile"><span class="account-avatar">管</span><span><strong>管理员</strong><small>系统管理</small></span></span><a href="#" id="logout-admin-link">退出后台</a>'
        : '<a href="admin.html">管理员登录</a>';
    }
    const adminEntryLink = showAdminEntry ? '<a href="admin.html#overview" title="进入后台管理" aria-label="进入后台管理">后台</a>' : '';
    if (loggedIn) {
      return `<a class="notification-trigger" href="my.html" aria-label="信息提示">🔔</a>${adminEntryLink}<span class="account-profile"><span class="account-avatar">${safeInitial(userName)}</span><span><strong>${safeHtml(userName)}</strong><small>预约用户</small></span></span><a href="#" id="logout-user-link">退出登录</a>`;
    }
    return `${adminEntryLink}<a href="login.html">用户登录</a><a href="register.html">微信注册/绑定</a>`;
  }

  function renderSidebarGroups(items) {
    const groups = [];
    items.forEach((item) => {
      let group = groups.find((entry) => entry.name === item.group);
      if (!group) {
        group = { name: item.group, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    });
    return groups.map((group) => `
      <div class="sidebar-section-title">${safeHtml(group.name || '导航')}</div>
      ${group.items.map((item) => `<a href="${item.href}" class="${isNavActive(item) ? 'active' : ''}"><span class="sidebar-icon">${safeHtml(item.icon || '·')}</span><span>${safeHtml(item.label)}</span></a>`).join('')}
    `).join('');
  }

  function getHeaderUserInfo() {
    try {
      return typeof getUserInfo === 'function' ? (getUserInfo() || {}) : {};
    } catch (_) {
      return {};
    }
  }

  function safeInitial(value) {
    return safeHtml(String(value || '用').trim().slice(0, 1) || '用');
  }
});

function safeHtml(value) {
  if (typeof escapeHtml === 'function') return escapeHtml(value);
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));
}

async function showSystemNoticeIfNeeded(options = {}) {
  if (typeof isLoggedIn !== 'function' || !isLoggedIn()) return;
  if (typeof callRestApi !== 'function') return;
  try {
    const result = await callRestApi('/system/notice');
    const notice = result.notice || {};
    if (!notice.enabled || !notice.content) return;
    const version = String(notice.version || '1');
    const storageKey = `IDBS_NOTICE_CLOSED_${version}`;
    if (!options.force && localStorage.getItem(storageKey) === '1') return;
    return openSystemNoticeModal(notice, storageKey, options);
  } catch (_) {
    // Notice should never block the user from entering the system.
  }
}

function openSystemNoticeModal(notice, storageKey, options = {}) {
  const existing = document.getElementById('system-notice-modal');
  if (existing) existing.remove();
  const autoCloseSeconds = Number(options.autoCloseSeconds || 0);
  const modal = document.createElement('div');
  modal.id = 'system-notice-modal';
  modal.className = 'notice-modal';
  modal.innerHTML = `
    <div class="notice-card">
      <div class="notice-kicker">系统提醒</div>
      <h2>${safeHtml(notice.title || '使用注意事项')}</h2>
      <div class="notice-content">${safeHtml(notice.content || '').replace(/\n/g, '<br>')}</div>
      ${autoCloseSeconds > 0 ? `<p class="notice-countdown">请先阅读注意事项，<span id="system-notice-countdown">${autoCloseSeconds}</span> 秒后将自动进入系统。</p>` : ''}
      <div class="actions">
        <button id="system-notice-close">我已了解，确认</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return new Promise((resolve) => {
    let done = false;
    let left = autoCloseSeconds;
    const countdownEl = document.getElementById('system-notice-countdown');
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      localStorage.setItem(storageKey, '1');
      modal.remove();
      if (typeof options.onClose === 'function') options.onClose();
      resolve();
    };
    const timer = autoCloseSeconds > 0 ? setInterval(() => {
      left -= 1;
      if (countdownEl) countdownEl.textContent = String(Math.max(left, 0));
      if (left <= 0) finish();
    }, 1000) : null;
    document.getElementById('system-notice-close').addEventListener('click', finish);
  });
}

async function openStaffContactModal() {
  const existing = document.getElementById('staff-contact-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'staff-contact-modal';
  modal.className = 'notice-modal staff-contact-modal';
  modal.innerHTML = `
    <div class="notice-card staff-contact-card">
      <div class="notice-kicker">工作人员联系方式</div>
      <div class="section-head compact-head">
        <div>
          <h2>紧急联系工作人员</h2>
        </div>
        <button id="staff-contact-close" class="secondary" type="button">关闭</button>
      </div>
      <div id="staff-contact-body" class="staff-contact-grid">
        <div class="empty-state">正在加载工作人员联系方式...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('staff-contact-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.remove();
  });

  const body = document.getElementById('staff-contact-body');
  try {
    if (typeof callRestApi !== 'function') throw new Error('当前页面暂时无法读取联系方式');
    const result = await callRestApi('/system/staff-contacts');
    const contacts = (result.contacts || []).filter((item) => item && item.enabled !== false);
    body.innerHTML = contacts.length
      ? contacts.map(renderStaffContactCard).join('')
      : '<div class="empty-state">管理员尚未配置工作人员联系方式。</div>';
  } catch (error) {
    body.innerHTML = `<div class="empty-state">${safeHtml(error.message || '联系方式加载失败，请稍后重试。')}</div>`;
  }
}

function renderStaffContactCard(contact = {}) {
  const name = contact.name || '待配置';
  const phone = contact.phone || '待配置';
  const qr = contact.qrcode_url || '';
  return `
    <article class="staff-contact-item">
      <div class="staff-contact-title">
        <strong>${safeHtml(contact.label || '工作人员')}</strong>
        <span>${safeHtml(contact.description || '')}</span>
      </div>
      <div class="staff-contact-qr">
        ${qr ? `<img src="${safeHtml(qr)}" alt="${safeHtml(contact.label || '工作人员')}二维码">` : '<div class="qr-placeholder">未上传二维码</div>'}
      </div>
      <dl class="staff-contact-meta">
        <div><dt>姓名</dt><dd>${safeHtml(name)}</dd></div>
        <div><dt>手机</dt><dd>${safeHtml(phone)}</dd></div>
      </dl>
      ${contact.phone ? `<a class="staff-call-link" href="tel:${safeHtml(contact.phone)}">拨打电话</a>` : ''}
    </article>
  `;
}
