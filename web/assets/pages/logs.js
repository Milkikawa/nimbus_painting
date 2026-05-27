import { api, asList, escapeHTML, fmtDate } from '../api.js';

export const logsPage = {
  title: '请求日志',
  eyebrow: 'Request Logs',
  async render(ctx) {
    ctx.root.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div><h2>请求日志</h2><p class="muted">展示最近 100 条请求记录和错误信息。</p></div>
          <button id="reloadLogs" class="button-secondary">刷新</button>
        </div>
        <div id="logsRoot"></div>
      </section>`;
    document.getElementById('reloadLogs').addEventListener('click', () => loadLogs(ctx));
    await loadLogs(ctx);
  }
};

async function loadLogs(ctx) {
  const list = asList(await api('/admin/api/logs'));
  const root = document.getElementById('logsRoot');
  if (!list.length) {
    root.innerHTML = '<div class="empty">暂无请求日志</div>';
    return;
  }
  root.innerHTML = `<div class="table-wrap"><table><thead><tr><th>时间</th><th>结果</th><th>模型</th><th>尺寸</th><th>Seed</th><th>Raw Prompt</th><th>Final Prompt</th><th>Negative</th><th>错误</th></tr></thead><tbody>${list.map((log) => {
    const ok = log.Success ?? log.success;
    return `<tr>
      <td>${fmtDate(log.CreatedAt || log.created_at)}</td>
      <td><span class="badge ${ok ? 'ok' : 'fail'}">${ok ? '成功' : '失败'}</span></td>
      <td>sd${escapeHTML(log.ModelIndex ?? log.model_index ?? '')}</td>
      <td>${escapeHTML(log.Width ?? log.width ?? '')} × ${escapeHTML(log.Height ?? log.height ?? '')}</td>
      <td>${escapeHTML(log.Seed ?? log.seed ?? '')}</td>
      <td>${escapeHTML(log.RawPrompt ?? log.raw_prompt ?? '')}</td>
      <td>${escapeHTML(log.FinalPrompt ?? log.final_prompt ?? '')}</td>
      <td>${escapeHTML(log.NegativePrompt ?? log.negative_prompt ?? '')}</td>
      <td>${escapeHTML(log.ErrorMessage ?? log.error_message ?? '')}</td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}
