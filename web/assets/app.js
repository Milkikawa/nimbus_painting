import { api } from './api.js';
import { overviewPage } from './pages/overview.js';
import { monitoringPage } from './pages/monitoring.js';
import { settingsPage } from './pages/settings.js';
import { promptsPage } from './pages/prompts.js';
import { imagesPage } from './pages/images.js';
import { logsPage } from './pages/logs.js';

const pages = { overview: overviewPage, monitoring: monitoringPage, settings: settingsPage, prompts: promptsPage, images: imagesPage, logs: logsPage };
const state = { status: null, activeView: 'overview' };
const el = {
  authView: document.getElementById('authView'), appView: document.getElementById('appView'), password: document.getElementById('password'),
  initButton: document.getElementById('initButton'), loginButton: document.getElementById('loginButton'), logoutButton: document.getElementById('logoutButton'),
  authTitle: document.getElementById('authTitle'), authHint: document.getElementById('authHint'), authMsg: document.getElementById('authMsg'),
  root: document.getElementById('pageRoot'), alert: document.getElementById('pageAlert'), toast: document.getElementById('toast'),
  viewTitle: document.getElementById('viewTitle'), viewEyebrow: document.getElementById('viewEyebrow'), serviceStatus: document.getElementById('serviceStatus')
};

const ctx = { root: el.root, toast, navigate, refreshStatus };

el.initButton.addEventListener('click', initAdmin);
el.loginButton.addEventListener('click', login);
el.logoutButton.addEventListener('click', logout);
el.password.addEventListener('keydown', (event) => { if (event.key === 'Enter') state.status?.initialized ? login() : initAdmin(); });
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
window.addEventListener('popstate', () => navigate(readView(), false));

boot();

async function boot() {
  await refreshStatus();
  if (state.status.authenticated) {
    showApp();
    await navigate(readView(), false);
    return;
  }
  showAuth();
}

async function refreshStatus() {
  state.status = await api('/admin/api/status');
  el.serviceStatus.textContent = state.status.upstream_configured ? '上游已配置' : '待配置上游';
  el.serviceStatus.style.borderColor = state.status.upstream_configured ? '#bbf7d0' : '#fed7aa';
  el.serviceStatus.style.background = state.status.upstream_configured ? '#f0fdf4' : '#fff7ed';
  el.serviceStatus.style.color = state.status.upstream_configured ? '#15803d' : '#c2410c';
}

function showAuth() {
  el.appView.classList.add('hidden');
  el.authView.classList.remove('hidden');
  el.authMsg.textContent = '';
  el.password.value = '';
  if (state.status.initialized) {
    el.authTitle.textContent = '登录';
    el.authHint.textContent = '请输入管理员密码进入后台。';
    el.initButton.classList.add('hidden');
    el.loginButton.classList.remove('hidden');
  } else {
    el.authTitle.textContent = '初始化管理员';
    el.authHint.textContent = '首次使用请设置至少 8 位管理员密码。';
    el.initButton.classList.remove('hidden');
    el.loginButton.classList.add('hidden');
  }
}

function showApp() {
  el.authView.classList.add('hidden');
  el.appView.classList.remove('hidden');
}

async function initAdmin() {
  try {
    await api('/admin/init', { method: 'POST', body: JSON.stringify({ password: el.password.value }) });
    toast('初始化成功，请登录', 'success');
    await refreshStatus();
    showAuth();
  } catch (error) { el.authMsg.textContent = error.message; }
}

async function login() {
  try {
    await api('/admin/login', { method: 'POST', body: JSON.stringify({ password: el.password.value }) });
    await refreshStatus();
    showApp();
    toast('登录成功', 'success');
    await navigate(readView(), false);
  } catch (error) { el.authMsg.textContent = error.message; }
}

async function logout() {
  try { await api('/admin/logout', { method: 'POST' }); } catch {}
  await refreshStatus();
  showAuth();
}

async function navigate(view, push = true) {
  const nextView = pages[view] ? view : 'overview';
  pages[state.activeView]?.cleanup?.();
  state.activeView = nextView;
  const page = pages[nextView];
  el.viewTitle.textContent = page.title;
  el.viewEyebrow.textContent = page.eyebrow;
  setActiveNav(nextView);
  clearAlert();
  el.root.innerHTML = '<div class="empty">加载中...</div>';
  if (push) history.pushState({}, '', `/dashboard?view=${encodeURIComponent(nextView)}`);
  try {
    await page.render(ctx);
  } catch (error) {
    if (error.status === 401) {
      await refreshStatus();
      showAuth();
      return;
    }
    showAlert(error.message);
    el.root.innerHTML = '<div class="empty">加载失败，请稍后重试。</div>';
  }
}

function readView() {
  return new URLSearchParams(location.search).get('view') || 'overview';
}

function setActiveNav(view) {
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
}

function showAlert(message) {
  el.alert.textContent = message;
  el.alert.classList.remove('hidden');
}

function clearAlert() {
  el.alert.textContent = '';
  el.alert.classList.add('hidden');
}

function toast(message, type = '') {
  el.toast.textContent = message;
  el.toast.className = `toast ${type}`.trim();
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => el.toast.classList.add('hidden'), 2600);
}
