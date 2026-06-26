import { api, asList, escapeHTML, fmtDate, safeURL } from "../api.js";

let activeLogs = [];
let activeIndex = -1;

export const logsPage = {
  title: "请求日志",
  eyebrow: "请求审计",
  cleanup() {
    closeDrawer();
    activeLogs = [];
    activeIndex = -1;
  },
  async render(ctx) {
    ctx.root.innerHTML = `
      <div class="settings-page-header">
        <div>
          <h2>请求日志</h2>
          <p class="page-desc">查看中间件截流到的请求详情与生成结果</p>
        </div>
        <div class="log-toolbar">
          <select id="logFilter" class="log-filter-select">
            <option value="all">全部</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
          </select>
          <button id="reloadLogs" class="btn-save">刷新</button>
        </div>
      </div>
      <div class="log-layout">
        <div class="log-list-panel" id="logListPanel">
          <div class="empty-inline">加载中...</div>
        </div>
        <div class="log-detail-panel hidden" id="logDetailPanel">
          <div class="log-detail-content" id="logDetailContent"></div>
        </div>
      </div>`;
    document.getElementById("reloadLogs").addEventListener("click", () => loadLogs(ctx));
    document.getElementById("logFilter").addEventListener("change", () => renderFilteredList(ctx));
    await loadLogs(ctx);
  },
};

async function loadLogs(ctx) {
  const btn = document.getElementById("reloadLogs");
  if (btn) { btn.classList.add("saving"); btn.textContent = "刷新中..."; }
  try {
    const list = asList(await api("/admin/api/logs")).map(normalizeLog);
    activeLogs = list;
    activeIndex = -1;
    renderFilteredList(ctx);
  } finally {
    if (btn) { btn.classList.remove("saving"); btn.textContent = "刷新"; }
  }
}

function renderFilteredList(ctx) {
  const filter = document.getElementById("logFilter")?.value || "all";
  let filtered = activeLogs;
  if (filter === "success") filtered = activeLogs.filter(l => l.ok);
  if (filter === "failed") filtered = activeLogs.filter(l => !l.ok);

  const panel = document.getElementById("logListPanel");
  if (!panel) return;

  if (!filtered.length) {
    panel.innerHTML = '<div class="empty-inline">暂无请求日志</div>';
    closeDrawer();
    return;
  }

  panel.innerHTML = filtered.map((log, idx) => {
    const realIdx = activeLogs.indexOf(log);
    return `<div class="log-list-item ${realIdx === activeIndex ? 'active' : ''}" data-log-idx="${realIdx}">
      <div class="log-item-left">
        <span class="badge ${log.ok ? 'badge-success' : 'badge-danger'}">${log.ok ? '成功' : '失败'}</span>
        <span class="log-item-model">${escapeHTML(log.upstreamModelName !== '—' ? log.upstreamModelName : 'sd' + log.modelIndex)}</span>
      </div>
      <div class="log-item-right">
        <span class="log-item-meta">${escapeHTML(log.size)}</span>
        <span class="log-item-time">${escapeHTML(log.createdAt)}</span>
      </div>
    </div>`;
  }).join("");

  panel.querySelectorAll("[data-log-idx]").forEach(item => {
    item.addEventListener("click", () => {
      const idx = Number(item.dataset.logIdx);
      openDrawer(idx, ctx);
    });
  });
}

function openDrawer(idx, ctx) {
  const log = activeLogs[idx];
  if (!log) return;
  activeIndex = idx;

  // Highlight active item
  document.querySelectorAll(".log-list-item").forEach(el => {
    el.classList.toggle("active", Number(el.dataset.logIdx) === idx);
  });

  const detailPanel = document.getElementById("logDetailPanel");
  const detailContent = document.getElementById("logDetailContent");
  detailPanel.classList.remove("hidden");

  detailContent.innerHTML = `
    <div class="log-detail-header">
      <div>
        <strong>请求详情</strong>
        <span class="badge ${log.ok ? 'badge-success' : 'badge-danger'}">${log.ok ? '成功' : '失败'}</span>
      </div>
      <button class="button-secondary" id="closeDrawer" type="button">关闭</button>
    </div>

    <!-- Section A: Images -->
    ${renderImages(log)}

    <!-- Section B: Core Parameters -->
    <div class="log-detail-section">
      <div class="log-detail-section-title">核心参数</div>
      <div class="log-params-grid">
        ${paramTile('模型', log.upstreamModelName !== '—' ? log.upstreamModelName : 'sd' + log.modelIndex)}
        ${paramTile('模型编号', 'sd' + log.modelIndex)}
        ${paramTile('尺寸', log.size)}
        ${paramTile('步数', log.steps)}
        ${paramTile('CFG', log.cfg)}
        ${paramTile('种子', log.seed)}
        ${paramTile('耗时', log.duration || '—')}
        ${paramTile('积分消耗', log.pointsUsed)}
        ${paramTile('剩余积分', log.remainingPoints)}
        ${paramTile('默认提示词', log.defaultPromptAppended ? '已附加' : '未附加')}
        ${paramTile('图片数量', log.imageCount || '1')}
        ${paramTile('请求时间', log.createdAt)}
      </div>
    </div>

    <!-- Section C: Prompt Results -->
    <div class="log-detail-section">
      <div class="log-detail-section-title">提示词处理结果</div>
      ${promptBlock('原始提示词', log.rawPrompt)}
      ${promptBlock('最终正面提示词', log.finalPrompt)}
      ${promptBlock('负面提示词', log.negativePrompt)}
    </div>

    <!-- Section D: Raw JSON (collapsible) -->
    <div class="log-detail-section">
      <details class="log-json-details">
        <summary class="log-detail-section-title clickable">原始请求 / 响应 JSON ▾</summary>
        <div class="log-json-tabs">
          ${log.upstreamRequestBody ? jsonBlock('上游请求体', log.upstreamRequestBody) : ''}
          ${log.upstreamResponseBody ? jsonBlock('上游响应体', log.upstreamResponseBody) : ''}
        </div>
      </details>
    </div>

    <!-- Section E: Meta Info -->
    <div class="log-detail-section">
      <div class="log-detail-section-title">请求元信息</div>
      <div class="log-params-grid">
        ${paramTile('上游状态码', log.upstreamStatus)}
        ${paramTile('状态', log.ok ? '成功' : '失败')}
        ${paramTile('图片返回方式', log.imageReturnMode || '—')}
        ${log.imageSaveError ? paramTile('图片保存错误', log.imageSaveError) : ''}
      </div>
      ${log.errorMessage ? `<div class="log-error-block"><span class="badge-danger">错误</span><pre class="log-error-text">${escapeHTML(log.errorMessage)}</pre></div>` : ''}
    </div>`;

  detailContent.querySelector("#closeDrawer")?.addEventListener("click", () => closeDrawer());

  // Copy buttons
  detailContent.querySelectorAll("[data-copy-prompt]").forEach(btn => {
    btn.addEventListener("click", () => {
      const text = btn.dataset.copyPrompt;
      navigator.clipboard.writeText(text).then(() => ctx.toast("已复制", "success")).catch(() => {});
    });
  });
}

function closeDrawer() {
  const panel = document.getElementById("logDetailPanel");
  if (panel) panel.classList.add("hidden");
  activeIndex = -1;
  document.querySelectorAll(".log-list-item.active").forEach(el => el.classList.remove("active"));
}

function renderImages(log) {
  const urls = [];
  if (log.downstreamImageURL) urls.push(log.downstreamImageURL);
  if (log.upstreamImageURL && log.upstreamImageURL !== log.downstreamImageURL) urls.push(log.upstreamImageURL);

  if (!urls.length) {
    return `<div class="log-detail-section"><div class="log-detail-section-title">生成图片</div><div class="empty-inline">该请求暂无截流图片</div></div>`;
  }

  return `<div class="log-detail-section">
    <div class="log-detail-section-title">生成图片</div>
    <div class="log-image-grid">
      ${urls.map(url => {
        const safe = safeURL(url);
        return safe ? `<a href="${escapeHTML(safe)}" target="_blank" rel="noreferrer" class="log-image-thumb"><img src="${escapeHTML(safe)}" alt="生成图片" loading="lazy"></a>` : '';
      }).join("")}
    </div>
  </div>`;
}

function paramTile(label, value) {
  return `<div class="log-param-tile"><span class="log-param-label">${escapeHTML(label)}</span><span class="log-param-value">${escapeHTML(String(value ?? '—'))}</span></div>`;
}

function promptBlock(title, content) {
  if (!content) return `<div class="log-prompt-block"><div class="log-prompt-title">${escapeHTML(title)}</div><div class="log-prompt-empty">无</div></div>`;
  const charCount = content.length;
  return `<div class="log-prompt-block">
    <div class="log-prompt-header">
      <span class="log-prompt-title">${escapeHTML(title)} <span class="log-prompt-count">${charCount} 字符</span></span>
      <button class="button-secondary prompt-card-btn" data-copy-prompt="${escapeHTML(content)}">复制</button>
    </div>
    <pre class="log-prompt-text">${escapeHTML(content)}</pre>
  </div>`;
}

function jsonBlock(title, content) {
  return `<div class="log-json-block">
    <div class="log-json-title">${escapeHTML(title)}</div>
    <pre class="log-json-text">${escapeHTML(content)}</pre>
  </div>`;
}

function normalizeLog(log) {
  const width = log.Width ?? log.width ?? "";
  const height = log.Height ?? log.height ?? "";
  return {
    ok: log.Success ?? log.success,
    createdAt: fmtDate(log.CreatedAt || log.created_at),
    modelIndex: log.ModelIndex ?? log.model_index ?? "",
    size: width && height ? `${width} × ${height}` : "—",
    seed: log.Seed ?? log.seed ?? "—",
    steps: log.Steps ?? log.steps ?? "—",
    cfg: log.CFG ?? log.cfg ?? "—",
    rawPrompt: log.RawPrompt ?? log.raw_prompt ?? "",
    finalPrompt: log.FinalPrompt ?? log.final_prompt ?? "",
    negativePrompt: log.NegativePrompt ?? log.negative_prompt ?? "",
    upstreamStatus: log.UpstreamStatus ?? log.upstream_status ?? "—",
    upstreamRequestBody: prettyJSON(log.UpstreamRequestBody ?? log.upstream_request_body ?? ""),
    upstreamResponseBody: prettyJSON(log.UpstreamResponseBody ?? log.upstream_response_body ?? ""),
    upstreamImageURL: log.UpstreamImageURL ?? log.upstream_image_url ?? "",
    upstreamModelName: log.UpstreamModelName ?? log.upstream_model_name ?? "—",
    pointsUsed: log.PointsUsed ?? log.points_used ?? 0,
    remainingPoints: log.RemainingPoints ?? log.remaining_points ?? 0,
    downstreamImageURL: log.DownstreamImageURL ?? log.downstream_image_url ?? "",
    imageSaveError: log.ImageSaveError ?? log.image_save_error ?? "",
    errorMessage: log.ErrorMessage ?? log.error_message ?? "",
    imageReturnMode: log.ImageReturnMode ?? log.image_return_mode ?? "",
    imageCount: log.ImageCount ?? log.image_count ?? "",
    duration: log.Duration ?? log.duration ?? "",
    defaultPromptAppended: log.DefaultPromptAppended ?? log.default_prompt_appended ?? false,
  };
}

function prettyJSON(value) {
  if (!value) return "";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
