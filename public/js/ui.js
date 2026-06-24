function showPageMessage(target, type, message) {
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) return;
  element.innerHTML = `<div class="alert ${type}">${escapeHtml(message)}</div>`;
}

function showToast(type, message, timeout = 2600) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div class="toast-title">${escapeHtml(message)}</div>`;
  host.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-leave');
    setTimeout(() => toast.remove(), 260);
  }, timeout);
}

function setLoading(target, message = '加载中...') {
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) return;
  element.innerHTML = `<div class="card card-center"><p class="muted">${escapeHtml(message)}</p></div>`;
}

function requireLogin(redirect = 'login.html') {
  if (!isLoggedIn()) {
    location.href = redirect;
    return false;
  }
  return true;
}

function requireAdminLogin() {
  if (!isAdminLoggedIn()) return false;
  return true;
}
