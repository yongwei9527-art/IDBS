document.addEventListener('DOMContentLoaded', () => {
  const header = document.createElement('header');
  const user = getUserInfo();

  header.innerHTML = `
    <div class="brand">
      <div class="brand-mark">R</div>
      <div>
        <h1>实验室设备预约系统</h1>
        <p class="brand-subtitle">稳定运行、清晰流程、轻柔界面</p>
      </div>
    </div>
    <nav>
      <a href="index.html">设备列表</a>
      <a href="reserve.html">发起预约</a>
      <a href="my.html">我的记录</a>
      ${isAdminLoggedIn() ? '<a href="admin.html">管理后台</a>' : ''}
      ${isLoggedIn()
        ? `<span class="nav-user">${escapeHtml(user && user.name ? user.name : '已登录用户')}</span><span class="role-chip">${isCurrentUserAdmin() ? '管理员' : '用户'}</span><a href="#" id="logout-user-link">退出登录</a>`
        : `<a href="login.html">用户登录</a><a href="register.html">用户注册</a>`}
      ${isAdminLoggedIn() ? `<a href="#" id="logout-admin-link">退出后台</a>` : ''}
    </nav>
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
});
