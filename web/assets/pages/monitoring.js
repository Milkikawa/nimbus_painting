import { api, fmtBytes, fmtDate, percent } from '../api.js';

export const monitoringPage = {
  title: '项目监测',
  eyebrow: 'Monitoring',
  async render(ctx) {
    ctx.root.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div><h2>当前快照</h2><p class="muted">不自动刷新、不后台采样；点击刷新时读取一次当前状态。</p></div>
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
  root.innerHTML = `
    <div class="metric-grid">
      <div class="metric"><span>运行时长</span><strong>${formatDuration(data.process?.uptime_seconds)}</strong></div>
      <div class="metric"><span>Goroutine</span><strong>${data.process?.goroutines ?? 0}</strong></div>
      <div class="metric"><span>当前内存</span><strong>${fmtBytes(data.process?.memory_alloc_bytes)}</strong></div>
      <div class="metric"><span>累计内存</span><strong>${fmtBytes(data.process?.memory_total_bytes)}</strong></div>
      <div class="metric"><span>GC 次数</span><strong>${data.process?.gc_count ?? 0}</strong></div>
      <div class="metric"><span>图片总数</span><strong>${data.images?.total ?? 0}</strong></div>
      <div class="metric"><span>未删除图片</span><strong>${data.images?.active ?? 0}</strong></div>
      <div class="metric"><span>已删除图片</span><strong>${data.images?.deleted ?? 0}</strong></div>
      <div class="metric"><span>任务总数</span><strong>${data.tasks?.total ?? 0}</strong></div>
      <div class="metric"><span>成功任务</span><strong>${data.tasks?.success ?? 0}</strong></div>
      <div class="metric"><span>失败任务</span><strong>${data.tasks?.failed ?? 0}</strong></div>
      <div class="metric"><span>成功率</span><strong>${percent(data.success_rate?.percentage)}</strong></div>
    </div>
    <section class="card" style="margin-top:16px;box-shadow:none">
      <h2>最近活动</h2>
      <p class="muted">最近图片：${fmtDate(data.images?.latest_image)} · 最近请求：${fmtDate(data.tasks?.latest_request)} · 图片占用：${fmtBytes(data.images?.storage_bytes)}</p>
    </section>`;
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
