document.addEventListener('DOMContentLoaded', () => {
  const header = document.createElement('header');
  const user = getUserInfo();
  const loggedIn = isLoggedIn();
  const currentUserIsAdmin = loggedIn && isCurrentUserAdmin();
  const showAdminEntry = currentUserIsAdmin || (!loggedIn && !!getAdminToken());

  header.innerHTML = `
    <div class="brand">
      <div class="brand-mark">R</div>
      <div>
        <h1>实验室设备预约系统</h1>
        <p class="brand-subtitle">稳定运行、清晰流程、轻量界面</p>
      </div>
    </div>
    <nav class="main-nav" aria-label="主导航">
      ${loggedIn ? '<a href="index.html">设备列表</a><a href="reserve.html">发起预约</a><a href="my.html">我的记录</a><a href="calendar.html">使用日历</a>' : ''}
      ${showAdminEntry ? '<a href="admin.html">管理后台</a>' : ''}
    </nav>
    <div class="account-nav">
      ${loggedIn
        ? `<span class="nav-user">${escapeHtml(user && user.name ? user.name : '已登录用户')}</span><span class="role-chip">${currentUserIsAdmin ? '管理员' : '用户'}</span><a href="#" id="logout-user-link">退出登录</a>`
        : '<a href="login.html">用户登录</a><a href="register.html">微信注册/绑定</a>'}
      ${showAdminEntry ? '<a href="#" id="logout-admin-link">退出后台</a>' : ''}
    </div>
  `;

  document.body.prepend(header);

  const logoutUserLink = document.getElementById('logout-user-link');
  if (logoutUserLink) {
    logoutUserLink.addEventListener('click', (event) => {
      event.preventDefault();
      logoutUser();
      location.href = 'login.html';
    });
  }

  const logoutAdminLink = document.getElementById('logout-admin-link');
  if (logoutAdminLink) {
    logoutAdminLink.addEventListener('click', (event) => {
      event.preventDefault();
      logoutAdmin();
      location.href = 'index.html';
    });
  }

  showSystemNoticeIfNeeded();
});

async function showSystemNoticeIfNeeded() {
  if (!isLoggedIn()) return;
  try {
    const result = await callRestApi('/system/notice');
    const notice = result.notice || {};
    if (!notice.enabled || !notice.content) return;
    const version = String(notice.version || '1');
    const storageKey = `IDBS_NOTICE_CLOSED_${version}`;
    if (localStorage.getItem(storageKey) === '1') return;
    openSystemNoticeModal(notice, storageKey);
  } catch (_) {
    // Notice should never block the user from entering the system.
  }
}

function openSystemNoticeModal(notice, storageKey) {
  const existing = document.getElementById('system-notice-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'system-notice-modal';
  modal.className = 'notice-modal';
  modal.innerHTML = `
    <div class="notice-card">
      <div class="notice-kicker">系统提醒</div>
      <h2>${escapeHtml(notice.title || '使用注意事项')}</h2>
      <div class="notice-content">${escapeHtml(notice.content || '').replace(/\n/g, '<br>')}</div>
      <div class="actions">
        <button id="system-notice-close">我已了解，关闭</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('system-notice-close').addEventListener('click', () => {
    localStorage.setItem(storageKey, '1');
    modal.remove();
  });
}
