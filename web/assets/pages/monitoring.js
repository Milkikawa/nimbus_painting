import { api, fmtBytes, fmtDate, percent } from '../api.js';

let uptimeTimer = null;

export const monitoringPage = {
  title: '项目监测',
  eyebrow: '运行监测',
  cleanup() {
    if (uptimeTimer) {
      window.clearInterval(uptimeTimer);
      uptimeTimer = null;
    }
  },
  async render(ctx) {
    this.cleanup();
    ctx.root.innerHTML = `
      <div class="settings-page-header">
        <div>
          <h2>运行监测</h2>
          <p class="page-desc">查看当前中间件运行状态、资源占用与任务统计</p>
        </div>
        <button id="reloadMonitoring" class="btn-save">刷新</button>
      </div>
      <div id="monitoringRoot"></div>`;
    document.getElementById('reloadMonitoring').addEventListener('click', () => loadMonitoring());
    await loadMonitoring();
  }
};

async function loadMonitoring() {
  const btn = document.getElementById('reloadMonitoring');
  if (btn) { btn.classList.add('saving'); btn.textContent = '刷新中...'; }
  try {
    const data = await api('/admin/api/monitoring/summary');
    const root = document.getElementById('monitoringRoot');
    if (!root) return;
    root.innerHTML = `
      <!-- 进程资源 -->
      <div class="settings-section">
        <div class="settings-section-title">进程资源</div>
        <div class="monitor-grid">
          ${statTile('运行时长', `<span id="uptimeValue">${formatDuration(data.process?.uptime_seconds)}</span>`)}
          ${statTile('协程数', data.process?.goroutines ?? 0)}
          ${statTile('当前占用内存', fmtBytes(data.process?.memory_alloc_bytes))}
          ${statTile('累计分配内存', fmtBytes(data.process?.memory_total_bytes))}
          ${statTile('系统占用内存', fmtBytes(data.process?.memory_sys_bytes))}
          ${statTile('GC 次数', data.process?.gc_count ?? 0)}
        </div>
      </div>

      <!-- 图片统计 -->
      <div class="settings-section">
        <div class="settings-section-title">图片统计</div>
        <div class="monitor-grid">
          ${statTile('图片总数', data.images?.total ?? 0)}
          ${statTile('现有图片', data.images?.active ?? 0)}
          ${statTile('已删除图片', data.images?.deleted ?? 0)}
          ${statTile('图片占用空间', fmtBytes(data.images?.storage_bytes))}
          ${statTile('最近图片', fmtDate(data.images?.latest_image))}
        </div>
      </div>

      <!-- 任务统计 -->
      <div class="settings-section">
        <div class="settings-section-title">任务统计</div>
        <div class="monitor-grid">
          ${statTile('任务总数', data.tasks?.total ?? 0)}
          ${statTile('成功任务', data.tasks?.success ?? 0, 'success')}
          ${statTile('失败任务', data.tasks?.failed ?? 0, 'danger')}
          ${statTile('进行中任务', data.tasks?.running ?? 0, 'warning')}
          ${statTile('已完成任务成功率', percent(data.success_rate?.percentage), 'primary')}
          ${statTile('最近请求', fmtDate(data.tasks?.latest_request))}
        </div>
      </div>

      <p class="monitor-note">运行时长在本地自动递增，不额外请求服务器。点击刷新获取最新数据。</p>`;

    startUptimeClock(Number(data.process?.uptime_seconds || 0));
  } finally {
    if (btn) { btn.classList.remove('saving'); btn.textContent = '刷新'; }
  }
}

function statTile(label, value, accent = '') {
  const accentClass = accent ? ` stat-${accent}` : '';
  return `<div class="stat-tile${accentClass}"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
}

function startUptimeClock(initialSeconds) {
  if (uptimeTimer) window.clearInterval(uptimeTimer);
  const startedAt = Date.now() - initialSeconds * 1000;
  const uptimeValue = document.getElementById('uptimeValue');
  if (!uptimeValue) return;
  const update = () => {
    uptimeValue.textContent = formatDuration(Math.floor((Date.now() - startedAt) / 1000));
  };
  update();
  uptimeTimer = window.setInterval(update, 1000);
}

function formatDuration(seconds = 0) {
  const value = Number(seconds || 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}
