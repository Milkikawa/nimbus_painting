import { api, asList, escapeHTML, fmtDate, safeURL } from "../api.js";
import { writeClipboardText } from "../clipboard.js";
import { ImageLightbox } from "../components/image-lightbox.js";

let pageEpoch = 0;
let loadSequence = 0;
let currentPage = null;
let currentRoot = null;

export const imagesPage = {
  title: "图片管理",
  eyebrow: "本地图库",
  cleanup() {
    cleanupCurrentPage();
  },
  async render(ctx) {
    cleanupCurrentPage();

    const root = ctx.root;
    const session = ++pageEpoch;
    root.innerHTML = `
      <div class="settings-page-header">
        <div>
          <h2>图片管理</h2>
          <p class="page-desc">查看中间件保存的生成图片</p>
        </div>
        <button id="reloadImages" class="btn-save" type="button">刷新</button>
      </div>
      <div id="imagesRoot"><div class="empty-inline">加载中...</div></div>`;

    const marker = document.createComment("images-page-session");
    root.prepend(marker);

    const page = {
      session,
      ctx,
      root,
      marker,
      reloadButton: root.querySelector("#reloadImages"),
      imagesRoot: root.querySelector("#imagesRoot"),
      loadController: null,
      loadSequence: 0,
      lightbox: null,
    };

    currentPage = page;
    currentRoot = root;
    page.lightbox = new ImageLightbox({ ariaLabel: "生成图片预览" });

    page.reloadButton?.addEventListener("click", () => {
      const restoreReloadFocus = document.activeElement === page.reloadButton;
      void loadImages(page, { initial: false, restoreReloadFocus }).catch(
        (error) => {
          console.error("刷新图片列表失败", error);
        }
      );
    });

    try {
      await loadImages(page, { initial: true });
    } catch (error) {
      if (!isCurrentPage(page)) return;
      cleanupCurrentPage();
      throw error;
    }
  },
};

function cleanupCurrentPage() {
  const page = currentPage;
  if (!page) return;

  currentPage = null;
  currentRoot = null;
  pageEpoch += 1;

  page.loadController?.abort();
  page.loadController = null;
  page.loadSequence = 0;
  page.lightbox?.destroy();
  page.lightbox = null;
  page.marker?.remove();
}

async function loadImages(
  page,
  { initial = false, restoreReloadFocus = false, focusCardIndex = null } = {}
) {
  if (!isCurrentPage(page)) return;

  page.loadController?.abort();
  const controller = new AbortController();
  const sequence = ++loadSequence;
  const root = page.root;
  const button = page.reloadButton;
  let listRendered = false;
  let shouldRestoreReloadFocus = restoreReloadFocus;
  let shouldRestorePostDeleteFocus = focusCardIndex !== null;
  page.loadController = controller;
  page.loadSequence = sequence;
  page.lightbox?.close({ restoreFocus: false });

  if (isCurrentLoad(page, sequence, root, controller) && button?.isConnected) {
    button.disabled = true;
    button.classList.add("saving");
    button.textContent = "刷新中...";
  }

  try {
    const list = asList(
      await api("/admin/api/images", { signal: controller.signal })
    );
    if (!isCurrentLoad(page, sequence, root, controller)) return;

    page.lightbox?.close({ restoreFocus: false });
    if (!list.length) {
      page.imagesRoot.innerHTML =
        '<div class="empty-inline">暂无图片记录</div>';
      listRendered = true;
      return;
    }

    page.imagesRoot.innerHTML = `<div class="img-grid">${list
      .map(imageCard)
      .join("")}</div>`;
    bindImageCards(page);
    listRendered = true;
  } catch (error) {
    if (isAbortError(error)) return;
    if (error?.status === 401) {
      shouldRestoreReloadFocus = false;
      shouldRestorePostDeleteFocus = false;
      if (page.loadSequence !== sequence || page.loadController !== controller)
        return;
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

      if (shouldRestorePostDeleteFocus) {
        if (listRendered) restoreFocusAfterDelete(page, focusCardIndex);
        else focusReloadButton(page);
      } else if (shouldRestoreReloadFocus) {
        focusReloadButton(page);
      }
    }
  }
}

function bindImageCards(page) {
  const root = page.imagesRoot;
  if (!isCurrentPage(page) || !root?.isConnected) return;

  root.querySelectorAll("[data-preview-image]").forEach((button) => {
    const image = button.querySelector("img");
    button.addEventListener("click", () => openImagePreview(page, button));

    if (!image) {
      handleImageUnavailable(page, button);
      return;
    }

    image.addEventListener("error", () => handleImageUnavailable(page, button));
    if (image.complete && image.naturalWidth === 0) {
      handleImageUnavailable(page, button);
    }
  });

  root.querySelectorAll("[data-delete-img]").forEach((button) => {
    button.addEventListener("click", () => {
      void deleteImage(page, button).catch((error) => {
        console.error("删除图片失败", error);
      });
    });
  });

  root.querySelectorAll("[data-copy-url]").forEach((button) => {
    button.addEventListener("click", () => {
      void copyImageURL(page, button).catch((error) => {
        console.error("复制图片链接失败", error);
      });
    });
  });
}

function openImagePreview(page, button) {
  if (!isCurrentPage(page) || !button?.isConnected || button.disabled) return;

  const publicURL = safeURL(button.dataset.previewImage);
  if (!publicURL) {
    handleImageUnavailable(page, button, { moveFocus: true });
    return;
  }

  page.lightbox?.open({
    src: publicURL,
    trigger: button,
    alt: "生成图片大图",
    onError: ({ trigger }) =>
      handleImageUnavailable(page, trigger, { moveFocus: true }),
  });
}

function handleImageUnavailable(page, button, { moveFocus = false } = {}) {
  if (!isCurrentPage(page) || !button?.isConnected) return;

  const isLightboxTrigger = page.lightbox?.isTrigger(button) === true;
  if (moveFocus || isLightboxTrigger || document.activeElement === button) {
    moveFocusFromImagePreview(page, button);
  }
  if (isLightboxTrigger) page.lightbox.close({ restoreFocus: false });

  const image = button.querySelector("img");
  if (image) image.removeAttribute("src");

  const placeholder = document.createElement("span");
  placeholder.className = "img-card-placeholder";
  placeholder.textContent = "图片不可用";

  button.replaceChildren(placeholder);
  button.removeAttribute("data-preview-image");
  button.setAttribute("aria-label", "图片不可用");
  button.classList.add("is-unavailable");
  button.disabled = true;
}

function moveFocusFromImagePreview(page, button) {
  const reloadButton = page.reloadButton;
  const cardAction = button
    ?.closest(".img-card")
    ?.querySelector(
      '.img-card-actions button:not(:disabled), .img-card-actions a[href]:not([aria-disabled="true"])'
    );
  const fallback =
    cardAction?.isConnected || reloadButton?.disabled
      ? cardAction
      : reloadButton;

  if (fallback?.isConnected) {
    fallback.focus();
  } else if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

async function deleteImage(page, button) {
  if (!isCurrentPage(page) || !button?.isConnected) return;

  const card = button.closest(".img-card");
  const cardIndex = Array.from(
    page.imagesRoot.querySelectorAll(".img-card")
  ).indexOf(card);
  if (!confirm("确认删除图片文件和记录？")) return;

  let shouldRestoreButtonFocus = document.activeElement === button;
  let deleteSucceeded = false;
  page.lightbox?.close({ restoreFocus: false });
  button.disabled = true;
  try {
    await api(
      `/admin/api/images/${encodeURIComponent(button.dataset.deleteImg)}`,
      { method: "DELETE", signal: page.ctx.signal }
    );
    deleteSucceeded = true;
    if (!isCurrentPage(page)) return;
    page.ctx.toast("图片已删除", "success");
    await loadImages(page, { initial: false, focusCardIndex: cardIndex });
  } catch (error) {
    if (isAbortError(error) || !isCurrentPage(page)) return;
    if (error?.status === 401) {
      shouldRestoreButtonFocus = false;
      page.ctx.unauthorized?.();
      return;
    }
    page.ctx.toast(error?.message || "删除失败，请稍后重试", "error");
  } finally {
    if (!deleteSucceeded && isCurrentPage(page) && button.isConnected) {
      button.disabled = false;
      if (shouldRestoreButtonFocus) button.focus();
    }
  }
}

function restoreFocusAfterDelete(page, cardIndex) {
  if (!isCurrentPage(page)) return;

  const cards = Array.from(page.imagesRoot.querySelectorAll(".img-card"));
  const targetIndex =
    Number.isInteger(cardIndex) && cardIndex >= 0
      ? Math.min(cardIndex, cards.length - 1)
      : -1;
  const card = cards[targetIndex];
  const preview = card?.querySelector(
    ".img-card-preview[data-preview-image]:not(:disabled)"
  );
  const cardAction = card?.querySelector(
    '.img-card-actions button:not(:disabled), .img-card-actions a[href]:not([aria-disabled="true"])'
  );
  const target = preview || cardAction;

  if (target?.isConnected) {
    target.focus();
    return;
  }
  focusReloadButton(page);
}

function focusReloadButton(page) {
  const button = page?.reloadButton;
  if (isCurrentPage(page) && button?.isConnected && !button.disabled) {
    button.focus();
    return true;
  }
  return false;
}

async function copyImageURL(page, button) {
  if (!isCurrentPage(page) || !button?.isConnected) return;

  const publicURL = safeURL(button.dataset.copyUrl);
  const copied = publicURL ? await writeClipboardText(publicURL) : false;
  if (!isCurrentPage(page)) return;
  page.ctx.toast(
    copied ? "链接已复制" : "复制失败，请手动复制链接",
    copied ? "success" : "error"
  );
}

function imageCard(image) {
  const publicURL = safeURL(image.public_url);
  const upstreamURL = safeURL(image.upstream_image_url);
  const modelName = image.upstream_model_name || `sd${image.model_index}`;
  const size =
    image.width && image.height ? `${image.width} × ${image.height}` : "—";
  const time = fmtDate(image.created_at);
  const seed = image.seed ?? "—";

  const preview = publicURL
    ? `<button
        type="button"
        class="img-card-preview"
        data-preview-image="${escapeHTML(publicURL)}"
        aria-label="查看生成图片大图"
      ><img src="${escapeHTML(
        publicURL
      )}" alt="生成图片" loading="lazy"></button>`
    : '<div class="img-card-placeholder">图片链接无效</div>';

  return `
    <article class="img-card">
      ${preview}
      <div class="img-card-body">
        <div class="img-card-info">
          <strong class="img-card-model">${escapeHTML(modelName)}</strong>
          <span class="img-card-meta">${escapeHTML(size)} · seed ${escapeHTML(
    seed
  )}</span>
          <span class="img-card-time">${escapeHTML(time)}</span>
        </div>
        <div class="img-card-actions">
          ${
            publicURL
              ? `<button class="button-secondary prompt-card-btn" type="button" data-copy-url="${escapeHTML(
                  publicURL
                )}">复制链接</button>`
              : ""
          }
          ${
            upstreamURL
              ? `<a href="${escapeHTML(
                  upstreamURL
                )}" target="_blank" rel="noreferrer" class="button-secondary prompt-card-btn">上游原图</a>`
              : ""
          }
          <button class="button-secondary prompt-card-btn btn-danger-text" type="button" data-delete-img="${escapeHTML(
            image.id
          )}">删除</button>
        </div>
      </div>
    </article>`;
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
