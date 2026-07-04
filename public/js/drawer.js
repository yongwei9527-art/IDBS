function ensureDrawerHost() {
  let host = document.getElementById('app-drawer-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'app-drawer-host';
    document.body.appendChild(host);
  }
  return host;
}

function closeDrawer() {
  const host = document.getElementById('app-drawer-host');
  if (!host) return;
  host.querySelector('.app-drawer-overlay')?.classList.add('closing');
  setTimeout(() => {
    host.innerHTML = '';
    document.body.classList.remove('drawer-open');
  }, 180);
}

function openDrawer({ title = '详情', subtitle = '', content = '', width = '720px' } = {}) {
  const host = ensureDrawerHost();
  document.body.classList.add('drawer-open');
  host.innerHTML = `
    <div class="app-drawer-overlay" role="presentation">
      <aside class="app-drawer" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" style="--drawer-width:${escapeHtml(width)}">
        <header class="app-drawer-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            ${subtitle ? `<p class="muted">${escapeHtml(subtitle)}</p>` : ''}
          </div>
          <button type="button" class="secondary app-drawer-close" aria-label="关闭">关闭</button>
        </header>
        <div class="app-drawer-body">${content}</div>
      </aside>
    </div>
  `;
  host.querySelector('.app-drawer-close')?.addEventListener('click', closeDrawer);
  host.querySelector('.app-drawer-overlay')?.addEventListener('click', (event) => {
    if (event.target.classList.contains('app-drawer-overlay')) closeDrawer();
  });
  document.addEventListener('keydown', function onKeydown(event) {
    if (event.key === 'Escape') {
      closeDrawer();
      document.removeEventListener('keydown', onKeydown);
    }
  });
}

function setDrawerContent(content = '') {
  const body = document.querySelector('#app-drawer-host .app-drawer-body');
  if (body) body.innerHTML = content;
}
