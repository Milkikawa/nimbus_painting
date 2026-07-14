import { api } from "./api.js";
import { overviewPage } from "./pages/overview.js";
import { monitoringPage } from "./pages/monitoring.js";
import { settingsPage } from "./pages/settings.js";
import { promptsPage } from "./pages/prompts.js";
import { imagesPage } from "./pages/images.js";
import { logsPage } from "./pages/logs.js";
import { modelsPage } from "./pages/models.js";

const pages = {
  overview: overviewPage,
  monitoring: monitoringPage,
  settings: settingsPage,
  models: modelsPage,
  prompts: promptsPage,
  images: imagesPage,
  logs: logsPage,
};
const state = { status: null, activeView: "overview" };
let navigationEpoch = 0;
let currentNavigationController = null;
let authEpoch = 0;
let pendingLogin = null;
let pendingLogout = null;

const el = {
  authView: document.getElementById("authView"),
  appView: document.getElementById("appView"),
  password: document.getElementById("password"),
  initButton: document.getElementById("initButton"),
  loginButton: document.getElementById("loginButton"),
  logoutButton: document.getElementById("logoutButton"),
  themeButton: document.getElementById("themeButton"),
  authTitle: document.getElementById("authTitle"),
  authHint: document.getElementById("authHint"),
  authMsg: document.getElementById("authMsg"),
  root: document.getElementById("pageRoot"),
  alert: document.getElementById("pageAlert"),
  toast: document.getElementById("toast"),
  viewTitle: document.getElementById("viewTitle"),
  viewEyebrow: document.getElementById("viewEyebrow"),
  serviceStatus: document.getElementById("serviceStatus"),
  sidebarStatusDot: document.getElementById("sidebarStatusDot"),
  sidebarStatusText: document.getElementById("sidebarStatusText"),
};

const ctx = {
  root: el.root,
  toast,
  navigate,
  refreshStatus: refreshStatusFromPage,
  unauthorized: handleUnauthorized,
};

el.initButton.addEventListener("click", () => {
  void initAdmin().catch(handleAuthEntryError);
});
el.loginButton.addEventListener("click", () => {
  void login().catch(handleAuthEntryError);
});
el.logoutButton.addEventListener("click", logout);
el.themeButton.addEventListener("click", toggleTheme);
el.password.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const action = state.status?.initialized === false ? initAdmin : login;
  void action().catch(handleAuthEntryError);
});
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    void navigate(button.dataset.view).catch(handleNavigationEntryError);
  });
});
window.addEventListener("popstate", () => {
  void navigate(readView(), false).catch(handleNavigationEntryError);
});

void boot().catch((error) => {
  console.error("启动认证检查失败", error);
  enterAuthView({ message: "无法获取服务状态，请稍后重试。" });
});

applyTheme(localStorage.getItem("np_theme") || "dark");

async function boot() {
  const authToken = beginAuthOperation();
  invalidateNavigation();
  showAuth();
  try {
    const status = await refreshStatus({ authToken });
    if (!status || !isCurrentAuthOperation(authToken)) return;
    if (status.authenticated) {
      showApp();
      await navigate(readView(), false);
      return;
    }
    enterAuthView();
  } catch (error) {
    if (!isCurrentAuthOperation(authToken)) return;
    console.error("刷新认证状态失败", error);
    enterAuthView({ message: "无法获取服务状态，请稍后重试。" });
  }
}

async function refreshStatus({ authToken } = {}) {
  const status = await api("/admin/api/status");
  if (authToken !== undefined && !isCurrentAuthOperation(authToken))
    return null;
  applyStatus(status);
  return status;
}

function refreshStatusFromPage() {
  const authToken = authEpoch;
  return refreshStatus({ authToken }).catch((error) => {
    if (!isCurrentAuthOperation(authToken)) return null;
    if (error?.status === 401) {
      handleUnauthorized();
      return null;
    }
    console.error("刷新服务状态失败", error);
    return null;
  });
}

function applyStatus(status) {
  state.status = status;
  el.serviceStatus.textContent = status.upstream_configured
    ? "上游已配置"
    : "待配置上游";
  el.serviceStatus.classList.toggle("ok", status.upstream_configured);
  el.serviceStatus.classList.toggle("warn", !status.upstream_configured);
  if (el.sidebarStatusDot) {
    el.sidebarStatusDot.className =
      "status-dot " + (status.upstream_configured ? "online" : "offline");
    el.sidebarStatusText.textContent = status.upstream_configured
      ? "服务运行中"
      : "待配置上游";
  }
}

function beginAuthOperation() {
  authEpoch += 1;
  return authEpoch;
}

function isCurrentAuthOperation(authToken) {
  return authToken === authEpoch;
}

function invalidateNavigation() {
  navigationEpoch += 1;
  currentNavigationController?.abort();
  currentNavigationController = null;
  return navigationEpoch;
}

function beginNavigation(id) {
  if (id !== navigationEpoch) return null;
  const controller = new AbortController();
  currentNavigationController = controller;
  return { id, controller };
}

function isCurrentNavigationToken(navigation) {
  return Boolean(
    navigation &&
      navigation.id === navigationEpoch &&
      navigation.controller === currentNavigationController &&
      !navigation.controller.signal.aborted
  );
}

function isCurrentNavigation(navigation, view, page) {
  return Boolean(
    isCurrentNavigationToken(navigation) &&
      state.activeView === view &&
      pages[view] === page &&
      !el.appView.classList.contains("hidden")
  );
}

function createNavigationContext(navigation, view, page) {
  const isCurrent = () => isCurrentNavigation(navigation, view, page);
  return {
    ...ctx,
    signal: navigation.controller.signal,
    navigationId: navigation.id,
    isCurrent,
    toast(message, type = "") {
      if (isCurrent()) toast(message, type);
    },
    refreshStatus() {
      if (!isCurrent()) return Promise.resolve(null);
      const authToken = authEpoch;
      return refreshStatus({ authToken }).catch((error) => {
        if (!isCurrent() || !isCurrentAuthOperation(authToken)) return null;
        if (error?.status === 401) {
          handleUnauthorized();
          return null;
        }
        console.error("刷新服务状态失败", error);
        return null;
      });
    },
    unauthorized(options) {
      if (!isCurrent()) return false;
      handleUnauthorized(options);
      return true;
    },
  };
}

function enterAuthView({ message = "" } = {}) {
  const authToken = beginAuthOperation();
  invalidateNavigation();
  if (state.status) state.status = { ...state.status, authenticated: false };
  cleanupActivePage({ leavingApp: true });
  showAuth({ message });
  return authToken;
}

function handleUnauthorized({ message = "登录状态已失效，请重新登录。" } = {}) {
  return enterAuthView({ message });
}

function showAuth({ message = "" } = {}) {
  el.appView.classList.add("hidden");
  el.authView.classList.remove("hidden");
  el.authMsg.textContent = message;
  el.password.value = "";

  const initialized = state.status?.initialized;
  const statusUnknown = initialized === undefined;
  el.password.disabled = false;
  el.initButton.disabled = false;
  el.loginButton.disabled = false;

  if (initialized === false) {
    el.authTitle.textContent = "初始化管理员";
    el.authHint.textContent = "首次使用请设置至少 8 位管理员密码。";
    el.initButton.classList.remove("hidden");
    el.loginButton.classList.add("hidden");
  } else {
    el.authTitle.textContent = "登录";
    el.authHint.textContent = statusUnknown
      ? "服务状态暂不可用，可尝试使用管理员密码登录。"
      : "请输入管理员密码进入后台。";
    el.initButton.classList.add("hidden");
    el.loginButton.classList.remove("hidden");
  }

  queueMicrotask(() => {
    if (
      !el.authView.classList.contains("hidden") &&
      el.appView.classList.contains("hidden") &&
      el.password.isConnected &&
      !el.password.disabled
    ) {
      el.password.focus();
    }
  });
}

function showApp() {
  el.authView.classList.add("hidden");
  el.appView.classList.remove("hidden");
  el.authMsg.textContent = "";
}

function setAuthActionsDisabled(disabled) {
  el.initButton.disabled = disabled;
  el.loginButton.disabled = disabled;
}

async function waitForPendingLogout(button) {
  const request = pendingLogout;
  if (button.disabled || !request) return null;

  setAuthActionsDisabled(true);
  const succeeded = await request;
  if (!succeeded) {
    el.authMsg.textContent = "退出请求失败，请重新登录后再退出。";
    setAuthActionsDisabled(false);
    return false;
  }
  return true;
}

function cleanupPage(page) {
  try {
    page?.cleanup?.();
  } catch (error) {
    console.error("页面清理失败", error);
  }
}

function cleanupActivePage({ leavingApp = false } = {}) {
  cleanupPage(pages[state.activeView]);
  if (!leavingApp) return;

  if (
    el.appView.contains(document.activeElement) &&
    document.activeElement instanceof HTMLElement
  ) {
    document.activeElement.blur();
  }
  el.root.classList.remove("logs-page-root", "logs-drawer-open");
  el.root.replaceChildren();
  clearToast();
  clearAlert();
}

async function initAdmin() {
  const waitedForLogout = await waitForPendingLogout(el.initButton);
  if (waitedForLogout === false) return;
  if (waitedForLogout === null && el.initButton.disabled) return;

  const authToken = beginAuthOperation();
  el.authMsg.textContent = "";
  setAuthActionsDisabled(true);
  try {
    await api("/admin/init", {
      method: "POST",
      body: JSON.stringify({ password: el.password.value }),
    });
    if (!isCurrentAuthOperation(authToken)) return;
    const status = await refreshStatus({ authToken });
    if (!status || !isCurrentAuthOperation(authToken)) return;
    showAuth({ message: "初始化成功，请登录。" });
  } catch (error) {
    if (isCurrentAuthOperation(authToken)) {
      el.authMsg.textContent = error?.message || "初始化失败，请稍后重试。";
    }
  } finally {
    if (isCurrentAuthOperation(authToken)) setAuthActionsDisabled(false);
  }
}

async function login() {
  const waitedForLogout = await waitForPendingLogout(el.loginButton);
  if (waitedForLogout === false) return;
  if (waitedForLogout === null && el.loginButton.disabled) return;

  const authToken = beginAuthOperation();
  el.authMsg.textContent = "";
  setAuthActionsDisabled(true);
  try {
    const request = api("/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: el.password.value }),
    });
    pendingLogin = request;
    try {
      await request;
    } finally {
      if (pendingLogin === request) pendingLogin = null;
    }
    if (!isCurrentAuthOperation(authToken)) return;
    const status = await refreshStatus({ authToken });
    if (!status || !isCurrentAuthOperation(authToken)) return;
    setAuthActionsDisabled(false);
    showApp();
    toast("登录成功", "success");
    await navigate(readView(), false);
  } catch (error) {
    if (isCurrentAuthOperation(authToken)) {
      el.authMsg.textContent = error?.message || "登录失败，请稍后重试。";
    }
  } finally {
    if (isCurrentAuthOperation(authToken)) setAuthActionsDisabled(false);
  }
}

function logout() {
  if (pendingLogout) return pendingLogout;

  const authToken = enterAuthView();
  setAuthActionsDisabled(true);

  const request = (async () => {
    if (pendingLogin) {
      try {
        await pendingLogin;
      } catch {
        // Login already reports its own error; logout must still clear any session.
      }
    }
    return api("/admin/logout", { method: "POST" })
      .then(() => true)
      .catch((error) => {
        console.error("退出请求失败", error);
        if (isCurrentAuthOperation(authToken)) {
          el.authMsg.textContent = "退出请求失败，请重新登录后再退出。";
        }
        return false;
      });
  })();

  pendingLogout = request;
  void request.finally(() => {
    if (pendingLogout === request) pendingLogout = null;
    if (isCurrentAuthOperation(authToken)) setAuthActionsDisabled(false);
  });
  return request;
}

async function navigate(view, push = true) {
  const nextView = pages[view] ? view : "overview";
  const previousPage = pages[state.activeView];
  const page = pages[nextView];
  const navigationId = invalidateNavigation();

  cleanupPage(previousPage);
  const navigation = beginNavigation(navigationId);
  if (!isCurrentNavigationToken(navigation)) return;

  state.activeView = nextView;
  el.viewTitle.textContent = page.title;
  el.viewEyebrow.textContent = page.eyebrow;
  setActiveNav(nextView);
  clearAlert();
  el.root.classList.remove("logs-page-root", "logs-drawer-open");
  el.root.innerHTML = '<div class="empty">加载中...</div>';
  if (push) {
    history.pushState(
      {},
      "",
      `/dashboard?view=${encodeURIComponent(nextView)}`
    );
  }

  const pageCtx = createNavigationContext(navigation, nextView, page);
  try {
    await page.render(pageCtx);
    if (!isCurrentNavigation(navigation, nextView, page)) return;
  } catch (error) {
    if (!isCurrentNavigation(navigation, nextView, page)) return;
    if (error?.status === 401) {
      handleUnauthorized();
      return;
    }
    cleanupPage(page);
    if (!isCurrentNavigation(navigation, nextView, page)) return;
    showAlert(error?.message || "页面加载失败，请稍后重试。");
    el.root.innerHTML = '<div class="empty">加载失败，请稍后重试。</div>';
  }
}

function readView() {
  return new URLSearchParams(location.search).get("view") || "overview";
}

function setActiveNav(view) {
  document
    .querySelectorAll("[data-view]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.view === view)
    );
}

function showAlert(message) {
  el.alert.textContent = message;
  el.alert.classList.remove("hidden");
}

function clearAlert() {
  el.alert.textContent = "";
  el.alert.classList.add("hidden");
}

function toast(message, type = "") {
  el.toast.textContent = message;
  el.toast.className = `toast ${type}`.trim();
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => el.toast.classList.add("hidden"), 2600);
}

function clearToast() {
  window.clearTimeout(toast.timer);
  toast.timer = null;
  el.toast.textContent = "";
  el.toast.className = "toast hidden";
}

function handleAuthEntryError(error) {
  console.error("认证操作失败", error);
  if (!el.authView.classList.contains("hidden")) {
    el.authMsg.textContent = "操作失败，请稍后重试。";
  }
}

function handleNavigationEntryError(error) {
  console.error("导航失败", error);
  if (el.appView.classList.contains("hidden")) return;
  showAlert("页面加载失败，请稍后重试。");
}

function toggleTheme() {
  const nextTheme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("np_theme", theme);
  el.themeButton.textContent = theme === "dark" ? "浅色模式" : "深色模式";
}
