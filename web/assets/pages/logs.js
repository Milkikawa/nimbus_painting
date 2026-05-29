import { api, asList, escapeHTML, fmtDate } from '../api.js';

export const logsPage = {
  title: '请求日志',
  eyebrow: 'Request Logs',
  async render(ctx) {
    ctx.root.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div><h2>请求日志</h2><p class="muted">展示最近 100 条请求记录。窄屏下会自动切换成卡片，避免内容被挤压换行。</p></div>
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
  root.innerHTML = `${renderTable(list)}${renderCards(list)}`;
}

function renderTable(list) {
  return `<div class="table-wrap logs-table"><table><thead><tr><th>时间</th><th>结果</th><th>模型</th><th>参数</th><th>Raw Prompt</th><th>Final Prompt</th><th>Negative</th><th>错误</th></tr></thead><tbody>${list.map((log) => {
    const data = normalizeLog(log);
    return `<tr>
      <td class="nowrap">${escapeHTML(data.createdAt)}</td>
      <td>${statusBadge(data.ok)}</td>
      <td class="nowrap">sd${escapeHTML(data.modelIndex)}</td>
      <td class="nowrap">${escapeHTML(data.size)}<br><span class="muted">seed ${escapeHTML(data.seed)}</span></td>
      <td><div class="log-text">${escapeHTML(data.rawPrompt)}</div></td>
      <td><div class="log-text">${escapeHTML(data.finalPrompt)}</div></td>
      <td><div class="log-text">${escapeHTML(data.negativePrompt)}</div></td>
      <td><div class="log-text error-text">${escapeHTML(data.errorMessage)}</div></td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderCards(list) {
  return `<div class="log-cards">${list.map((log) => {
    const data = normalizeLog(log);
    return `<article class="log-card">
      <div class="log-card-head">
        <div>
          <strong>${escapeHTML(data.createdAt)}</strong>
          <span class="muted">sd${escapeHTML(data.modelIndex)} · ${escapeHTML(data.size)} · seed ${escapeHTML(data.seed)}</span>
        </div>
        ${statusBadge(data.ok)}
      </div>
      ${logBlock('Raw Prompt', data.rawPrompt)}
      ${logBlock('Final Prompt', data.finalPrompt)}
      ${data.negativePrompt ? logBlock('Negative', data.negativePrompt) : ''}
      ${data.errorMessage ? logBlock('错误', data.errorMessage, 'error-text') : ''}
    </article>`;
  }).join('')}</div>`;
}

function normalizeLog(log) {
  const width = log.Width ?? log.width ?? '';
  const height = log.Height ?? log.height ?? '';
  return {
    ok: log.Success ?? log.success,
    createdAt: fmtDate(log.CreatedAt || log.created_at),
    modelIndex: log.ModelIndex ?? log.model_index ?? '',
    size: width && height ? `${width} × ${height}` : '—',
    seed: log.Seed ?? log.seed ?? '—',
    rawPrompt: log.RawPrompt ?? log.raw_prompt ?? '',
    finalPrompt: log.FinalPrompt ?? log.final_prompt ?? '',
    negativePrompt: log.NegativePrompt ?? log.negative_prompt ?? '',
    errorMessage: log.ErrorMessage ?? log.error_message ?? ''
  };
}

function statusBadge(ok) {
  return `<span class="badge ${ok ? 'ok' : 'fail'}">${ok ? '成功' : '失败'}</span>`;
}

function logBlock(label, value, extraClass = '') {
  return `<section class="log-block"><span>${label}</span><div class="log-text ${extraClass}">${escapeHTML(value || '—')}</div></section>`;
}
