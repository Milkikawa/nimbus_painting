import { api, asList, escapeHTML, fmtDate, safeURL } from "../api.js";

let activeLogs = [];

export const logsPage = {
  title: "请求日志",
  eyebrow: "请求审计",
  cleanup() {
    closeLogSheet();
    activeLogs = [];
  },
  async render(ctx) {
    ctx.root.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div><h2>请求日志</h2><p class="muted">默认只显示摘要；完整 Prompt、请求体和响应体通过详情抽屉查看，避免窄屏长文本换行挤压。</p></div>
          <button id="reloadLogs" class="button-secondary">刷新</button>
        </div>
        <div id="logsRoot"></div>
      </section>`;
    document
      .getElementById("reloadLogs")
      .addEventListener("click", () => loadLogs(ctx));
    await loadLogs(ctx);
  },
};

async function loadLogs(ctx) {
  const list = asList(await api("/admin/api/logs")).map(normalizeLog);
  const root = document.getElementById("logsRoot");
  activeLogs = list;
  if (!list.length) {
    root.innerHTML = '<div class="empty">暂无请求日志</div>';
    return;
  }
  root.innerHTML = `${renderTable(list)}${renderCards(list)}`;
  root.querySelectorAll("[data-log-detail]").forEach((button) => {
    button.addEventListener("click", () =>
      openLogSheet(Number(button.dataset.logDetail))
    );
  });
}

function renderTable(list) {
  return `<div class="table-wrap logs-table"><table><thead><tr><th>时间</th><th>结果</th><th>模型</th><th>生图参数</th><th>提示词摘要</th><th>上游摘要</th><th>详情</th></tr></thead><tbody>${list
    .map(
      (data, index) => `
    <tr>
      <td class="nowrap">${escapeHTML(data.createdAt)}</td>
      <td>${statusBadge(data.ok)}</td>
      <td class="nowrap">sd${escapeHTML(
        data.modelIndex
      )}<br><span class="muted">${escapeHTML(
        data.upstreamModelName
      )}</span></td>
      <td class="nowrap">${escapeHTML(
        data.size
      )}<br><span class="muted">steps ${escapeHTML(
        data.steps
      )} / cfg ${escapeHTML(
        data.cfg
      )}</span><br><span class="muted">seed ${escapeHTML(data.seed)}</span></td>
      <td><div class="log-summary">${escapeHTML(
        summary(data.finalPrompt || data.rawPrompt)
      )}</div></td>
      <td><div class="log-summary ${
        data.errorMessage ? "error-text" : ""
      }">${escapeHTML(
        summary(
          data.errorMessage || data.upstreamResponseBody || data.pointsText
        )
      )}</div></td>
      <td><button class="detail-button" type="button" data-log-detail="${index}">查看完整</button></td>
    </tr>`
    )
    .join("")}</tbody></table></div>`;
}

function renderCards(list) {
  return `<div class="log-cards">${list
    .map(
      (data, index) => `
    <article class="log-card">
      <div class="log-card-head">
        <div>
          <strong>${escapeHTML(data.createdAt)}</strong>
          <span class="muted">sd${escapeHTML(data.modelIndex)} · ${escapeHTML(
        data.size
      )} · seed ${escapeHTML(data.seed)}</span>
        </div>
        ${statusBadge(data.ok)}
      </div>
      ${summaryBlock("提示词摘要", data.finalPrompt || data.rawPrompt)}
      ${summaryBlock(
        "上游摘要",
        data.errorMessage || data.upstreamResponseBody || data.pointsText,
        data.errorMessage ? "error-text" : ""
      )}
      <button class="detail-button" type="button" data-log-detail="${index}">展开完整请求与响应</button>
    </article>`
    )
    .join("")}</div>`;
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
    upstreamRequestBody: prettyJSON(
      log.UpstreamRequestBody ?? log.upstream_request_body ?? ""
    ),
    upstreamResponseBody: prettyJSON(
      log.UpstreamResponseBody ?? log.upstream_response_body ?? ""
    ),
    upstreamImageURL: log.UpstreamImageURL ?? log.upstream_image_url ?? "",
    upstreamModelName: log.UpstreamModelName ?? log.upstream_model_name ?? "—",
    pointsText: `消耗 ${log.PointsUsed ?? log.points_used ?? 0} / 剩余 ${
      log.RemainingPoints ?? log.remaining_points ?? 0
    }`,
    downstreamImageURL:
      log.DownstreamImageURL ?? log.downstream_image_url ?? "",
    imageSaveError: log.ImageSaveError ?? log.image_save_error ?? "",
    errorMessage: log.ErrorMessage ?? log.error_message ?? "",
  };
}

function openLogSheet(index) {
  const data = activeLogs[index];
  if (!data) return;
  closeLogSheet();
  const sheet = document.createElement("section");
  sheet.className = "log-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.innerHTML = `
    <div class="log-sheet-panel">
      <div class="log-sheet-head">
        <div>
          <strong>${escapeHTML(data.createdAt)}</strong>
          <div class="muted">sd${escapeHTML(data.modelIndex)} · ${escapeHTML(
    data.size
  )} · ${data.ok ? "成功" : "失败"}</div>
        </div>
        <button class="button-secondary" type="button" data-close-log>关闭</button>
      </div>
      <div class="log-sheet-body">
        ${detailBlock("用户输入", data.rawPrompt)}
        ${detailBlock("最终正面提示词", data.finalPrompt)}
        ${
          data.negativePrompt
            ? detailBlock("负面提示词", data.negativePrompt)
            : ""
        }
        ${detailBlock("实际上游请求体", data.upstreamRequestBody)}
        ${detailBlock("上游原始响应体", data.upstreamResponseBody)}
        ${detailBlock("点数信息", data.pointsText)}
        ${detailLink("下游返回图片", data.downstreamImageURL)}
        ${detailLink("上游原图", data.upstreamImageURL)}
        ${
          data.imageSaveError
            ? detailBlock("本地保存错误", data.imageSaveError, "error-text")
            : ""
        }
        ${
          data.errorMessage
            ? detailBlock("错误", data.errorMessage, "error-text")
            : ""
        }
      </div>
    </div>`;
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet || event.target.closest("[data-close-log]"))
      closeLogSheet();
  });
  document.addEventListener("keydown", closeOnEscape);
  document.body.appendChild(sheet);
}

function closeLogSheet() {
  document.querySelector(".log-sheet")?.remove();
  document.removeEventListener("keydown", closeOnEscape);
}

function closeOnEscape(event) {
  if (event.key === "Escape") closeLogSheet();
}

function statusBadge(ok) {
  return `<span class="badge ${ok ? "ok" : "fail"}">${
    ok ? "成功" : "失败"
  }</span>`;
}

function summaryBlock(label, value, extraClass = "") {
  return `<section class="log-block"><span>${label}</span><div class="log-summary ${extraClass}">${escapeHTML(
    summary(value)
  )}</div></section>`;
}

function detailBlock(label, value, extraClass = "") {
  return `<section class="log-block"><span>${label}</span><pre class="${extraClass}">${escapeHTML(
    value || "—"
  )}</pre></section>`;
}

function detailLink(label, value) {
  if (!value) return detailBlock(label, "—");
  const url = safeURL(value);
  if (!url) return detailBlock(label, "链接无效");
  return `<section class="log-block"><span>${label}</span><a href="${escapeHTML(
    url
  )}" target="_blank" rel="noreferrer">${escapeHTML(url)}</a></section>`;
}

function summary(value) {
  const compact = String(value || "—")
    .replace(/\s+/g, " ")
    .trim();
  return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact;
}

function prettyJSON(value) {
  if (!value) return "";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
