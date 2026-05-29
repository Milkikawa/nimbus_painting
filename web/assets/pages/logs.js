import { api, asList, escapeHTML, fmtDate } from '../api.js';

export const logsPage = {
  title: '请求日志',
  eyebrow: '请求审计',
  async render(ctx) {
    ctx.root.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div><h2>请求日志</h2><p class="muted">展示最近 100 条请求记录，包含实际生图参数、上游原始响应和下游返回图片链接。</p></div>
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
  return `<div class="table-wrap logs-table"><table><thead><tr><th>时间</th><th>结果</th><th>模型</th><th>生图参数</th><th>提示词</th><th>上游响应</th><th>图片链接</th><th>错误</th></tr></thead><tbody>${list.map((log) => {
    const data = normalizeLog(log);
    return `<tr>
      <td class="nowrap">${escapeHTML(data.createdAt)}</td>
      <td>${statusBadge(data.ok)}</td>
      <td class="nowrap">sd${escapeHTML(data.modelIndex)}<br><span class="muted">${escapeHTML(data.upstreamModelName)}</span></td>
      <td class="nowrap">${escapeHTML(data.size)}<br><span class="muted">steps ${escapeHTML(data.steps)} / cfg ${escapeHTML(data.cfg)}</span><br><span class="muted">seed ${escapeHTML(data.seed)}</span></td>
      <td>${logBlock('用户输入', data.rawPrompt)}${logBlock('最终正面', data.finalPrompt)}${data.negativePrompt ? logBlock('负面提示词', data.negativePrompt) : ''}</td>
      <td>${logBlock('状态码', data.upstreamStatus)}${logBlock('原始响应', data.upstreamResponseBody)}${logBlock('点数', data.pointsText)}</td>
      <td>${linkBlock('下游返回', data.downstreamImageURL)}${linkBlock('上游原图', data.upstreamImageURL)}${data.imageSaveError ? logBlock('本地保存错误', data.imageSaveError, 'error-text') : ''}</td>
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
      ${logBlock('用户输入', data.rawPrompt)}
      ${logBlock('最终正面提示词', data.finalPrompt)}
      ${data.negativePrompt ? logBlock('负面提示词', data.negativePrompt) : ''}
      ${logBlock('实际上游请求体', data.upstreamRequestBody)}
      ${logBlock('上游原始响应体', data.upstreamResponseBody)}
      ${logBlock('上游模型名称', data.upstreamModelName)}
      ${logBlock('点数信息', data.pointsText)}
      ${linkBlock('下游返回图片', data.downstreamImageURL)}
      ${linkBlock('上游原图', data.upstreamImageURL)}
      ${data.imageSaveError ? logBlock('本地保存错误', data.imageSaveError, 'error-text') : ''}
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
    steps: log.Steps ?? log.steps ?? '—',
    cfg: log.CFG ?? log.cfg ?? '—',
    rawPrompt: log.RawPrompt ?? log.raw_prompt ?? '',
    finalPrompt: log.FinalPrompt ?? log.final_prompt ?? '',
    negativePrompt: log.NegativePrompt ?? log.negative_prompt ?? '',
    upstreamStatus: log.UpstreamStatus ?? log.upstream_status ?? '—',
    upstreamRequestBody: prettyJSON(log.UpstreamRequestBody ?? log.upstream_request_body ?? ''),
    upstreamResponseBody: prettyJSON(log.UpstreamResponseBody ?? log.upstream_response_body ?? ''),
    upstreamImageURL: log.UpstreamImageURL ?? log.upstream_image_url ?? '',
    upstreamModelName: log.UpstreamModelName ?? log.upstream_model_name ?? '—',
    pointsText: `消耗 ${log.PointsUsed ?? log.points_used ?? 0} / 剩余 ${log.RemainingPoints ?? log.remaining_points ?? 0}`,
    downstreamImageURL: log.DownstreamImageURL ?? log.downstream_image_url ?? '',
    imageSaveError: log.ImageSaveError ?? log.image_save_error ?? '',
    errorMessage: log.ErrorMessage ?? log.error_message ?? ''
  };
}

function statusBadge(ok) {
  return `<span class="badge ${ok ? 'ok' : 'fail'}">${ok ? '成功' : '失败'}</span>`;
}

function logBlock(label, value, extraClass = '') {
  return `<section class="log-block"><span>${label}</span><div class="log-text ${extraClass}">${escapeHTML(value || '—')}</div></section>`;
}

function linkBlock(label, value) {
  if (!value) return logBlock(label, '—');
  return `<section class="log-block"><span>${label}</span><div class="log-text"><a href="${escapeHTML(value)}" target="_blank" rel="noreferrer">${escapeHTML(value)}</a></div></section>`;
}

function prettyJSON(value) {
  if (!value) return '';
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}
