import { settingsSummary } from './settings.js';
import { api, fmtDate, percent } from '../api.js';

export const overviewPage = {
  title: '概览',
  eyebrow: '总览',
  async render(ctx) {
    ctx.root.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div><h2>项目概览</h2><p class="muted">快速查看配置、任务和图片状态。</p></div>
          <button id="openMonitoring" class="button-secondary">查看监测</button>
        </div>
        <div id="overviewRoot" class="metric-grid"></div>
      </section>`;
    document.getElementById('openMonitoring').addEventListener('click', () => ctx.navigate('monitoring'));
    const [monitoring, settings] = await Promise.all([api('/admin/api/monitoring/summary'), settingsSummary()]);
    document.getElementById('overviewRoot').innerHTML = `
      <div class="metric"><span>上游接口</span><strong>${settings.endpoint}</strong></div>
      <div class="metric"><span>默认模型</span><strong>${settings.model}</strong></div>
      <div class="metric"><span>默认尺寸</span><strong>${settings.size}</strong></div>
      <div class="metric"><span>任务总数</span><strong>${monitoring.tasks?.total ?? 0}</strong></div>
      <div class="metric"><span>成功率</span><strong>${percent(monitoring.success_rate?.percentage)}</strong></div>
      <div class="metric"><span>图片总数</span><strong>${monitoring.images?.total ?? 0}</strong></div>
      <div class="metric"><span>最近请求</span><strong>${fmtDate(monitoring.tasks?.latest_request)}</strong></div>
      <div class="metric"><span>服务状态</span><strong>运行中</strong></div>`;
  }
};
