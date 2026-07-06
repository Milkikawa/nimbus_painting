import { settingsSummary } from './settings.js';
import { api, asList, fmtDate, percent, escapeHTML } from '../api.js';

export const overviewPage = {
  title: '概览',
  eyebrow: '总览',
  async render(ctx) {
    ctx.root.innerHTML = `
      <div class="settings-page-header">
        <div>
          <h2>概览</h2>
          <p class="page-desc">快速查看配置、任务和图片状态</p>
        </div>
        <button id="overviewRefresh" class="btn-save">刷新</button>
      </div>
      <div id="overviewRoot"><div class="empty">加载中...</div></div>`;
    document.getElementById('overviewRefresh').addEventListener('click', () => loadOverview(ctx));
    await loadOverview(ctx);
  }
};

async function loadOverview(ctx) {
  const btn = document.getElementById('overviewRefresh');
  if (btn) { btn.classList.add('saving'); btn.textContent = '刷新中...'; }
  try {
    const [monitoring, settings, logs] = await Promise.all([
      api('/admin/api/monitoring/summary'),
      settingsSummary(),
      api('/admin/api/logs?limit=5').then(asList).catch(() => [])
    ]);
    const root = document.getElementById('overviewRoot');
    if (!root) return;

    // Build KPI cards from real monitoring data
    const kpis = [];
    kpis.push({ label: '服务状态', value: '运行中', accent: 'success' });
    kpis.push({ label: '上游接口', value: settings.endpoint });
    kpis.push({ label: '默认模型', value: settings.model });
    kpis.push({ label: '默认尺寸', value: settings.size });
    kpis.push({ label: '任务总数', value: String(monitoring.tasks?.total ?? 0) });
    kpis.push({ label: '成功率', value: percent(monitoring.success_rate?.percentage), accent: 'primary' });
    kpis.push({ label: '图片总数', value: String(monitoring.images?.total ?? 0) });
    kpis.push({ label: '最近请求', value: fmtDate(monitoring.tasks?.latest_request) });

    // Model statistics: server-side all-time aggregation grouped by upstream model_name
    // (index-reuse safe). Denominator monitoring.tasks.total is also all-time, so the
    // per-model percentage stays consistent with the counts.
    const modelStats = Array.isArray(monitoring.model_usage) ? monitoring.model_usage : [];

    // Recent activity from logs (last 5)
    const recentLogs = logs.slice(0, 5);

    root.innerHTML = `
      <!-- KPI Grid -->
      <div class="settings-section">
        <div class="settings-section-title">核心指标</div>
        <div class="overview-kpi-grid">
          ${kpis.map(kpi => kpiCard(kpi)).join('')}
        </div>
      </div>

      <!-- Service Status Summary -->
      <div class="settings-section">
        <div class="settings-section-title">运行状态摘要</div>
        <div class="monitor-grid">
          ${statTile('上游接口', settings.endpoint)}
          ${statTile('默认模型', settings.model)}
          ${statTile('默认尺寸', settings.size)}
          ${statTile('运行时长', formatDuration(monitoring.process?.uptime_seconds))}
          ${statTile('最近请求', fmtDate(monitoring.tasks?.latest_request))}
          ${statTile('进行中任务', String(monitoring.tasks?.running ?? 0))}
        </div>
      </div>

      <!-- Model Usage Statistics -->
      <div class="settings-section">
        <div class="settings-section-title">模型使用统计</div>
        ${modelStats.length > 0 ? renderModelStats(modelStats, monitoring.tasks?.total || 1) : '<div class="empty-inline">暂无模型统计数据</div>'}
      </div>

      <!-- Recent Activity -->
      <div class="settings-section">
        <div class="settings-section-title">最近活动</div>
        ${recentLogs.length > 0 ? renderRecentLogs(recentLogs) : '<div class="empty-inline">暂无请求记录</div>'}
      </div>`;
  } finally {
    if (btn) { btn.classList.remove('saving'); btn.textContent = '刷新'; }
  }
}

function kpiCard({ label, value, accent = '' }) {
  const accentClass = accent ? ` kpi-${accent}` : '';
  return `<div class="kpi-card${accentClass}"><span class="kpi-label">${escapeHTML(label)}</span><span class="kpi-value">${escapeHTML(value)}</span></div>`;
}

function statTile(label, value) {
  return `<div class="stat-tile"><span class="stat-label">${escapeHTML(label)}</span><span class="stat-value">${escapeHTML(value)}</span></div>`;
}

function renderModelStats(stats, total) {
  const max = stats[0]?.count || 1;
  return `<div class="model-stats-list">
    ${stats.map(s => {
      const pct = total > 0 ? ((s.count / total) * 100).toFixed(1) : '0';
      const barWidth = Math.max(4, (s.count / max) * 100);
      return `<div class="model-stat-row">
        <div class="model-stat-info">
          <span class="model-stat-name">${escapeHTML(s.name)}</span>
          <span class="model-stat-count">${s.count} 次 · ${pct}%</span>
        </div>
        <div class="model-stat-bar-bg"><div class="model-stat-bar" style="width:${barWidth}%"></div></div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderRecentLogs(logs) {
  return `<div class="recent-logs-list">
    ${logs.map(log => {
      const ok = log.Success ?? log.success;
      const time = fmtDate(log.CreatedAt || log.created_at);
      const model = log.UpstreamModelName || log.upstream_model_name || `sd${log.ModelIndex ?? log.model_index ?? ''}`;
      const width = log.Width ?? log.width ?? '';
      const height = log.Height ?? log.height ?? '';
      const size = width && height ? `${width}×${height}` : '';
      return `<div class="recent-log-item">
        <span class="badge ${ok ? 'badge-success' : 'badge-danger'}">${ok ? '成功' : '失败'}</span>
        <span class="recent-log-model">${escapeHTML(model)}</span>
        ${size ? `<span class="recent-log-meta">${escapeHTML(size)}</span>` : ''}
        <span class="recent-log-time">${escapeHTML(time)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function formatDuration(seconds = 0) {
  const value = Number(seconds || 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${value}s`;
}
