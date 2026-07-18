import { api, asList, escapeHTML, fmtDate, safeURL } from "../api.js";
import { writeClipboardText } from "../clipboard.js";
import { ImageLightbox } from "../components/image-lightbox.js";

let activeLogs = [];
let activeIndex = -1;
let pageEpoch = 0;
let loadSequence = 0;
let currentPage = null;
let currentRoot = null;

export const logsPage = {
  title: "请求日志",
  eyebrow: "请求审计",
  cleanup() {
    cleanupCurrentPage();
  },
  async render(ctx) {
    cleanupCurrentPage();

    const root = ctx.root;
    const session = ++pageEpoch;

    root.classList.add("logs-page-root");
    root.innerHTML = `
      <div class="settings-page-header">
        <div>
          <h2>请求日志</h2>
          <p class="page-desc">查看中间件截流到的请求详情与生成结果</p>
        </div>
        <div class="log-toolbar">
          <select
            id="logFilter"
            class="log-filter-select"
            aria-label="筛选请求日志"
          >
            <option value="all">全部</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
          </select>
          <button id="reloadLogs" class="btn-save" type="button">刷新</button>
        </div>
      </div>
      <div class="log-layout">
        <div class="log-list-panel" id="logListPanel">
          <div class="empty-inline">加载中...</div>
        </div>
        <div
          class="log-detail-panel hidden"
          id="logDetailPanel"
          role="region"
          aria-labelledby="logDetailTitle"
          aria-hidden="true"
        >
          <div class="log-detail-content" id="logDetailContent"></div>
        </div>
      </div>`;

    const marker = document.createComment("logs-page-session");
    root.prepend(marker);

    const page = {
      session,
      ctx,
      root,
      marker,
      reloadButton: root.querySelector("#reloadLogs"),
      filterSelect: root.querySelector("#logFilter"),
      listPanel: root.querySelector("#logListPanel"),
      detailPanel: root.querySelector("#logDetailPanel"),
      detailContent: root.querySelector("#logDetailContent"),
      drawerTrigger: null,
      loadController: null,
      loadSequence: 0,
      lightbox: null,
    };

    currentPage = page;
    currentRoot = root;
    page.lightbox = new ImageLightbox({ ariaLabel: "本地归档图片预览" });

    page.reloadButton?.addEventListener("click", () => {
      void loadLogs(page, { initial: false }).catch((error) => {
        console.error("刷新请求日志失败", error);
      });
    });
    page.filterSelect?.addEventListener("change", () => {
      if (isCurrentPage(page)) renderFilteredList(page);
    });

    document.addEventListener("keydown", handlePageKeydown);

    try {
      await loadLogs(page, { initial: true });
    } catch (error) {
      if (!isCurrentPage(page)) return;
      cleanupCurrentPage();
      throw error;
    }
  },
};

function cleanupCurrentPage() {
  const page = currentPage;
  document.removeEventListener("keydown", handlePageKeydown);

  if (page) {
    currentPage = null;
    currentRoot = null;
    pageEpoch += 1;

    if (page.loadController) page.loadController.abort();
    page.loadController = null;
    page.loadSequence = 0;
    blurFocusWithin(page.root);
    closeDrawer(page, { restoreFocus: false, clearContent: true });
    page.lightbox?.destroy();
    page.lightbox = null;
    page.root?.classList.remove("logs-page-root");
    page.marker?.remove();

    currentRoot = null;
  }

  activeLogs = [];
  activeIndex = -1;
}

async function loadLogs(page, { initial = false } = {}) {
  if (!isCurrentPage(page)) return;

  if (page.loadController) page.loadController.abort();
  const controller = new AbortController();
  const sequence = ++loadSequence;
  const root = page.root;
  const button = page.reloadButton;
  page.loadController = controller;
  page.loadSequence = sequence;

  closeDrawer(page, { restoreFocus: false, clearContent: true });
  if (isCurrentLoad(page, sequence, root, controller) && button?.isConnected) {
    button.disabled = true;
    button.classList.add("saving");
    button.textContent = "刷新中...";
  }

  try {
    const list = asList(
      await api("/admin/api/logs", { signal: controller.signal })
    ).map(normalizeLog);
    if (!isCurrentLoad(page, sequence, root, controller)) return;

    activeLogs = list;
    activeIndex = -1;
    renderFilteredList(page, { restoreFocus: false });
  } catch (error) {
    if (isAbortError(error)) return;
    if (error?.status === 401) {
      if (page.loadSequence !== sequence || page.loadController !== controller)
        return;
      activeLogs = [];
      activeIndex = -1;
      page.ctx.unauthorized?.();
      return;
    }
    if (!isCurrentLoad(page, sequence, root, controller)) return;
    if (!initial) {
      page.ctx.toast(error?.message || "刷新失败，请稍后重试", "error");
      return;
    }
    throw error;
  } finally {
    if (isCurrentLoad(page, sequence, root, controller)) {
      page.loadController = null;
      page.loadSequence = 0;
      if (button?.isConnected && button === page.reloadButton) {
        button.disabled = false;
        button.classList.remove("saving");
        button.textContent = "刷新";
      }
    }
  }
}

function renderFilteredList(page, { restoreFocus = true } = {}) {
  if (!isCurrentPage(page)) return;

  const filter = page.filterSelect?.value || "all";
  let filtered = activeLogs;
  if (filter === "success") filtered = activeLogs.filter((log) => log.ok);
  if (filter === "failed") filtered = activeLogs.filter((log) => !log.ok);

  const panel = page.listPanel;
  if (!panel?.isConnected || !page.root.contains(panel)) return;

  if (page.drawerTrigger || !page.detailPanel.classList.contains("hidden")) {
    closeDrawer(page, { restoreFocus: false, clearContent: true });
    if (restoreFocus) {
      page.filterSelect?.focus();
    }
  }

  if (!filtered.length) {
    panel.innerHTML = '<div class="empty-inline">暂无请求日志</div>';
    return;
  }

  panel.innerHTML = filtered
    .map((log) => {
      const realIdx = activeLogs.indexOf(log);
      return `<button
        type="button"
        class="log-list-item ${realIdx === activeIndex ? "active" : ""}"
        data-log-idx="${realIdx}"
        aria-expanded="false"
        aria-controls="logDetailPanel"
      >
        <span class="log-item-left">
          <span class="badge ${log.ok ? "badge-success" : "badge-danger"}">${
        log.ok ? "成功" : "失败"
      }</span>
          <span class="log-item-model">${escapeHTML(
            log.upstreamModelName !== "—"
              ? log.upstreamModelName
              : "sd" + log.modelIndex
          )}</span>
        </span>
        <span class="log-item-right">
          <span class="log-item-meta">${escapeHTML(log.size)}</span>
          <span class="log-item-time">${escapeHTML(log.createdAt)}</span>
        </span>
      </button>`;
    })
    .join("");

  panel.querySelectorAll("[data-log-idx]").forEach((item) => {
    item.addEventListener("click", () => {
      if (!isCurrentPage(page) || !item.isConnected) return;
      const idx = Number(item.dataset.logIdx);
      openDrawer(page, idx, item);
    });
  });
}

function openDrawer(page, idx, trigger) {
  if (!isCurrentPage(page)) return;
  const log = activeLogs[idx];
  if (!log) return;

  page.lightbox?.close({ restoreFocus: false });

  const { detailPanel, detailContent, listPanel } = page;
  if (
    !detailPanel?.isConnected ||
    !detailContent?.isConnected ||
    !page.root.contains(detailPanel) ||
    !page.root.contains(detailContent)
  )
    return;

  clearDetailContent(detailContent);
  activeIndex = idx;
  const previousTrigger = page.drawerTrigger;
  page.drawerTrigger = trigger?.isConnected ? trigger : null;
  if (previousTrigger?.isConnected && previousTrigger !== page.drawerTrigger) {
    previousTrigger.setAttribute("aria-expanded", "false");
  }

  listPanel.querySelectorAll(".log-list-item").forEach((item) => {
    const isActive = Number(item.dataset.logIdx) === idx;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-expanded", String(isActive));
  });

  page.root.classList.add("logs-drawer-open");
  detailContent.innerHTML = `
    <div class="log-detail-header">
      <div>
        <strong id="logDetailTitle">请求详情</strong>
        <span class="badge ${log.ok ? "badge-success" : "badge-danger"}">${
    log.ok ? "成功" : "失败"
  }</span>
      </div>
      <button class="button-secondary" id="closeDrawer" type="button">关闭</button>
    </div>

    <!-- Section A: Images -->
    ${renderImages(log)}

    <!-- Section B: Core Parameters -->
    <div class="log-detail-section">
      <div class="log-detail-section-title">核心参数</div>
      <div class="log-params-grid">
        ${paramTile(
          "模型",
          log.upstreamModelName !== "—"
            ? log.upstreamModelName
            : "sd" + log.modelIndex
        )}
        ${paramTile("模型编号", "sd" + log.modelIndex)}
        ${paramTile("尺寸", log.size)}
        ${paramTile("步数", log.steps)}
        ${paramTile("CFG", log.cfg)}
        ${paramTile("种子", log.seed)}
        ${paramTile("耗时", log.duration || "—")}
        ${paramTile("积分消耗", log.pointsUsed)}
        ${paramTile("剩余积分", log.remainingPoints)}
        ${paramTile(
          "默认提示词",
          log.defaultPromptAppended ? "已附加" : "未附加"
        )}
        ${paramTile("图片数量", log.imageCount || "1")}
        ${paramTile("请求时间", log.createdAt)}
      </div>
    </div>

    <!-- Section C: Prompt Results -->
    <div class="log-detail-section">
      <div class="log-detail-section-title">提示词处理结果</div>
      ${promptBlock("原始提示词", log.rawPrompt)}
      ${promptBlock("最终正面提示词", log.finalPrompt)}
      ${promptBlock("负面提示词", log.negativePrompt)}
    </div>

    <!-- Section D: Raw JSON (collapsible) -->
    <div class="log-detail-section">
      <details class="log-json-details">
        <summary class="log-detail-section-title clickable">原始请求 / 响应 JSON ▾</summary>
        <div class="log-json-tabs">
          ${
            log.upstreamRequestBody
              ? jsonBlock("上游请求体", log.upstreamRequestBody)
              : ""
          }
          ${
            log.upstreamResponseBody
              ? jsonBlock("上游响应体", log.upstreamResponseBody)
              : ""
          }
        </div>
      </details>
    </div>

    <!-- Section E: Meta Info -->
    <div class="log-detail-section">
      <div class="log-detail-section-title">请求元信息</div>
      <div class="log-params-grid">
        ${paramTile("上游状态码", log.upstreamStatus)}
        ${paramTile("状态", log.ok ? "成功" : "失败")}
        ${paramTile("图片返回方式", log.imageReturnMode || "—")}
        ${
          log.imageSaveError
            ? paramTile("图片保存错误", log.imageSaveError)
            : ""
        }
      </div>
      ${
        log.errorMessage
          ? `<div class="log-error-block"><span class="badge-danger">错误</span><pre class="log-error-text">${escapeHTML(
              log.errorMessage
            )}</pre></div>`
          : ""
      }
    </div>`;

  const closeButton = detailContent.querySelector("#closeDrawer");
  closeButton?.addEventListener("click", () => closeDrawer(page));

  // Copy buttons
  detailContent.querySelectorAll("[data-copy-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!isCurrentPage(page)) return;
      const text = button.dataset.copyPrompt;
      void writeClipboardText(text)
        .then((copied) => {
          if (!isCurrentPage(page)) return;
          page.ctx.toast(
            copied ? "已复制" : "复制失败",
            copied ? "success" : "error"
          );
        })
        .catch((error) => {
          console.error("复制日志提示词失败", error);
        });
    });
  });

  // Local archive thumbnails are the only images that may be loaded automatically.
  detailContent.querySelectorAll("[data-local-image]").forEach((button) => {
    const image = button.querySelector("img");
    const markReady = () => {
      if (!isCurrentPage(page) || !button.isConnected) return;
      button.dataset.localImageReady = "true";
      button.setAttribute("aria-busy", "false");
    };

    button.addEventListener("click", () => {
      if (isCurrentPage(page) && button.dataset.localImageReady === "true")
        openLocalImageLightbox(page, button);
    });

    if (!image) {
      setLocalThumbnailUnavailable(page, button);
      return;
    }

    image.addEventListener("load", markReady);
    image.addEventListener("error", () =>
      handleLocalThumbnailError(page, button)
    );
    if (image.complete) {
      if (image.naturalWidth > 0) markReady();
      else handleLocalThumbnailError(page, button);
    }
  });

  detailPanel.setAttribute("aria-hidden", "false");
  detailPanel.classList.remove("hidden");
  closeButton?.focus();
}

function closeDrawer(page, { restoreFocus = true, clearContent = true } = {}) {
  if (!page) return;

  page.lightbox?.close({ restoreFocus: false });
  const { detailPanel, detailContent, listPanel } = page;
  const trigger = page.drawerTrigger;
  const focusInDrawer = detailPanel?.contains(document.activeElement);

  if (trigger?.isConnected) {
    trigger.setAttribute("aria-expanded", "false");
  }

  if (restoreFocus && trigger?.isConnected && !trigger.disabled) {
    trigger.focus();
  } else if (restoreFocus && focusInDrawer) {
    page.filterSelect?.focus();
    if (detailPanel?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  } else if (focusInDrawer) {
    document.activeElement.blur();
  }

  detailPanel?.setAttribute("aria-hidden", "true");
  detailPanel?.classList.add("hidden");
  page.root?.classList.remove("logs-drawer-open");

  if (clearContent) clearDetailContent(detailContent);
  page.drawerTrigger = null;
  activeIndex = -1;
  listPanel?.querySelectorAll(".log-list-item").forEach((item) => {
    item.classList.remove("active");
    item.setAttribute("aria-expanded", "false");
  });
}

function clearDetailContent(detailContent) {
  if (!detailContent) return;
  detailContent.querySelectorAll("img").forEach((image) => {
    image.removeAttribute("src");
  });
  detailContent.replaceChildren();
}

function renderImages(log) {
  const localURL = safeURL(log.localImageURL);
  const localPreview = localURL
    ? `<button
        type="button"
        class="log-image-thumb"
        data-local-image="${escapeHTML(localURL)}"
        aria-label="查看本地归档图片大图"
        aria-busy="true"
      >
        <img src="${escapeHTML(
          localURL
        )}" alt="本地归档生成图片" loading="lazy">
        <span class="log-image-hint" aria-hidden="true">点击查看大图</span>
      </button>`
    : '<div class="log-image-placeholder" role="status">本地归档不可用</div>';
  const upstreamLink = renderUpstreamImageLink(log.upstreamImageURL);

  return `<div class="log-detail-section">
    <div class="log-detail-section-title">生成图片</div>
    <div class="log-image-area">
      <div class="log-image-grid">${localPreview}</div>
      ${
        upstreamLink
          ? `<div class="log-image-actions">${upstreamLink}</div>`
          : ""
      }
    </div>
  </div>`;
}

function renderUpstreamImageLink(value) {
  const upstreamURL = safeURL(value);
  if (!upstreamURL) return "";
  return `<a
    href="${escapeHTML(upstreamURL)}"
    target="_blank"
    rel="noreferrer"
    class="button-secondary prompt-card-btn log-image-upstream-link"
  >上游原图</a>`;
}

function openLocalImageLightbox(page, button) {
  if (
    !isCurrentPage(page) ||
    !button?.isConnected ||
    button.disabled ||
    button.dataset.localImageReady !== "true"
  )
    return;

  const localURL = safeURL(button.dataset.localImage);
  if (!localURL) {
    moveFocusToDrawerClose(page);
    page.lightbox?.close({ restoreFocus: false });
    setLocalThumbnailUnavailable(page, button);
    return;
  }

  page.lightbox?.open({
    src: localURL,
    trigger: button,
    alt: "本地归档生成图片大图",
    onError: ({ trigger }) => {
      if (!isCurrentPage(page) || !trigger?.isConnected) return;
      moveFocusToDrawerClose(page);
      setLocalThumbnailUnavailable(page, trigger);
    },
  });
}

function handlePageKeydown(event) {
  if (event.defaultPrevented) return;

  const page = currentPage;
  if (!isCurrentPage(page)) return;
  if (page.lightbox?.isOpen) return;
  if (page.detailPanel?.classList.contains("hidden")) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeDrawer(page);
    return;
  }

  if (event.key === "Tab" && isMobileDrawerViewport()) {
    trapFocus(
      event,
      page.detailPanel,
      page.detailContent?.querySelector("#closeDrawer")
    );
  }
}

function trapFocus(event, container, fallback) {
  const focusable = getFocusableElements(container);
  event.preventDefault();
  if (!focusable.length) {
    fallback?.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const activeIndex = focusable.indexOf(active);
  if (event.shiftKey) {
    if (active === first || activeIndex < 0) last.focus();
    else focusable[activeIndex - 1].focus();
  } else if (active === last || activeIndex < 0) {
    first.focus();
  } else {
    focusable[activeIndex + 1].focus();
  }
}

function isMobileDrawerViewport() {
  if (typeof window.matchMedia !== "function") return false;
  try {
    return Boolean(window.matchMedia("(max-width: 980px)")?.matches);
  } catch {
    return false;
  }
}

function handleLocalThumbnailError(page, button) {
  if (!isCurrentPage(page) || !button?.isConnected) return;
  const isLightboxTrigger = page.lightbox?.isTrigger(button) === true;
  if (document.activeElement === button || isLightboxTrigger) {
    moveFocusToDrawerClose(page);
  }
  if (isLightboxTrigger) page.lightbox.close({ restoreFocus: false });
  setLocalThumbnailUnavailable(page, button);
}

function setLocalThumbnailUnavailable(page, button) {
  if (!isCurrentPage(page) || !button?.isConnected) return;
  if (document.activeElement === button) moveFocusToDrawerClose(page);

  const image = button.querySelector("img");
  if (image) image.removeAttribute("src");

  const placeholder = document.createElement("span");
  placeholder.className = "log-image-placeholder";
  placeholder.textContent = "本地归档不可用";

  button.replaceChildren(placeholder);
  button.removeAttribute("data-local-image");
  button.removeAttribute("data-local-image-ready");
  button.setAttribute("aria-label", "本地归档不可用");
  button.setAttribute("aria-busy", "false");
  button.classList.add("is-unavailable");
  button.disabled = true;
}

function moveFocusToDrawerClose(page) {
  const closeButton = page?.detailContent?.querySelector("#closeDrawer");
  if (closeButton?.isConnected && !closeButton.disabled) {
    closeButton.focus();
    return true;
  }
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  return false;
}

function getFocusableElements(container) {
  return Array.from(
    container.querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hidden && element.getClientRects().length > 0);
}

function blurFocusWithin(container) {
  if (
    container?.contains(document.activeElement) &&
    document.activeElement instanceof HTMLElement
  ) {
    document.activeElement.blur();
  }
}

function isCurrentPage(page) {
  return Boolean(
    page &&
      currentPage === page &&
      currentRoot === page.root &&
      page.session === pageEpoch &&
      page.ctx?.isCurrent?.() !== false &&
      page.root?.isConnected &&
      page.marker?.isConnected &&
      page.root.contains(page.marker)
  );
}

function isCurrentLoad(page, sequence, root, controller) {
  return Boolean(
    isCurrentPage(page) &&
      root === page.root &&
      root === currentRoot &&
      page.loadSequence === sequence &&
      page.loadController === controller &&
      !controller.signal.aborted
  );
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function paramTile(label, value) {
  return `<div class="log-param-tile"><span class="log-param-label">${escapeHTML(
    label
  )}</span><span class="log-param-value">${escapeHTML(
    String(value ?? "—")
  )}</span></div>`;
}

function promptBlock(title, content) {
  if (!content)
    return `<div class="log-prompt-block"><div class="log-prompt-title">${escapeHTML(
      title
    )}</div><div class="log-prompt-empty">无</div></div>`;
  const charCount = content.length;
  return `<div class="log-prompt-block">
    <div class="log-prompt-header">
      <span class="log-prompt-title">${escapeHTML(
        title
      )} <span class="log-prompt-count">${charCount} 字符</span></span>
      <button class="button-secondary prompt-card-btn" data-copy-prompt="${escapeHTML(
        content
      )}">复制</button>
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
    upstreamRequestBody: prettyJSON(
      log.UpstreamRequestBody ?? log.upstream_request_body ?? ""
    ),
    upstreamResponseBody: prettyJSON(
      log.UpstreamResponseBody ?? log.upstream_response_body ?? ""
    ),
    localImageURL: log.LocalImageURL ?? log.local_image_url ?? "",
    upstreamImageURL: log.UpstreamImageURL ?? log.upstream_image_url ?? "",
    upstreamModelName: log.UpstreamModelName ?? log.upstream_model_name ?? "—",
    pointsUsed: log.PointsUsed ?? log.points_used ?? 0,
    remainingPoints: log.RemainingPoints ?? log.remaining_points ?? 0,
    downstreamImageURL:
      log.DownstreamImageURL ?? log.downstream_image_url ?? "",
    imageSaveError: log.ImageSaveError ?? log.image_save_error ?? "",
    errorMessage: log.ErrorMessage ?? log.error_message ?? "",
    imageReturnMode: log.ImageReturnMode ?? log.image_return_mode ?? "",
    imageCount: log.ImageCount ?? log.image_count ?? "",
    duration: log.Duration ?? log.duration ?? "",
    defaultPromptAppended:
      log.DefaultPromptAppended ?? log.default_prompt_appended ?? false,
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
