import { api, fmtBytes, fmtDate, percent } from '../api.js';

let uptimeTimer = null;

export const monitoringPage = {
  title: '项目监测',
  eyebrow: 'Monitoring',
  cleanup() {
    if (uptimeTimer) {
      window.clearInterval(uptimeTimer);
      uptimeTimer = null;
    }
  },
  async render(ctx) {
    this.cleanup();
    ctx.root.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div>
            <h2>当前快照</h2>
            <p class="muted">资源统计点击刷新时读取一次；运行时长会在本地自动流动，不额外请求服务器。</p>
          </div>
          <button id="reloadMonitoring" class="button-secondary">刷新</button>
        </div>
        <div id="monitoringRoot"></div>
    </section>`;
    document.getElementById('reloadMonitoring').addEventListener('click', () => loadMonitoring());
    await loadMonitoring();
  }
};

async function loadMonitoring() {
  const data = await api('/admin/api/monitoring/summary');
  const root = document.getElementById('monitoringRoot');
  if (!root) return;
  root.innerHTML = `
    <div class="metric-grid">
      <div class="metric"><span>运行时长</span><strong id="uptimeValue">${formatDuration(data.process?.uptime_seconds)}</strong></div>
      <div class="metric"><span>协程数</span><strong>${data.process?.goroutines ?? 0}</strong></div>
      <div class="metric"><span>当前占用内存</span><strong>${fmtBytes(data.process?.memory_alloc_bytes)}</strong></div>
      <div class="metric"><span>累计分配内存</span><strong>${fmtBytes(data.process?.memory_total_bytes)}</strong></div>
      <div class="metric"><span>系统占用内存</span><strong>${fmtBytes(data.process?.memory_sys_bytes)}</strong></div>
      <div class="metric"><span>GC 次数</span><strong>${data.process?.gc_count ?? 0}</strong></div>
      <div class="metric"><span>图片总数</span><strong>${data.images?.total ?? 0}</strong></div>
      <div class="metric"><span>现有图片</span><strong>${data.images?.active ?? 0}</strong></div>
      <div class="metric"><span>已删除图片</span><strong>${data.images?.deleted ?? 0}</strong></div>
      <div class="metric"><span>图片占用空间</span><strong>${fmtBytes(data.images?.storage_bytes)}</strong></div>
      <div class="metric"><span>任务总数</span><strong>${data.tasks?.total ?? 0}</strong></div>
      <div class="metric"><span>成功任务</span><strong>${data.tasks?.success ?? 0}</strong></div>
      <div class="metric"><span>失败任务</span><strong>${data.tasks?.failed ?? 0}</strong></div>
      <div class="metric"><span>进行中任务</span><strong>${data.tasks?.running ?? 0}</strong></div>
      <div class="metric"><span>已完成任务成功率</span><strong>${percent(data.success_rate?.percentage)}</strong></div>
    </div>
    <section class="card" style="margin-top:16px;box-shadow:none">
      <h2>最近活动</h2>
      <p class="muted">最近图片：${fmtDate(data.images?.latest_image)} · 最近请求：${fmtDate(data.tasks?.latest_request)}</p>
      <p class="muted">说明：成功率只按已结束的任务记录计算，进行中任务单独显示，不会提前算成功或失败。</p>
    </section>`;
  startUptimeClock(Number(data.process?.uptime_seconds || 0));
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
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}
