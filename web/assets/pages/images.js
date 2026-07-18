import { api, asList, escapeHTML, fmtDate, safeURL } from "../api.js";
import { writeClipboardText } from "../clipboard.js";

export const imagesPage = {
  title: "图片管理",
  eyebrow: "本地图库",
  async render(ctx) {
    ctx.root.innerHTML = `
      <div class="settings-page-header">
        <div>
          <h2>图片管理</h2>
          <p class="page-desc">查看中间件保存的生成图片</p>
        </div>
        <button id="reloadImages" class="btn-save">刷新</button>
      </div>
      <div id="imagesRoot"><div class="empty-inline">加载中...</div></div>`;
    document
      .getElementById("reloadImages")
      .addEventListener("click", () => loadImages(ctx));
    await loadImages(ctx);
  },
};

async function loadImages(ctx) {
  const btn = document.getElementById("reloadImages");
  if (btn) { btn.classList.add("saving"); btn.textContent = "刷新中..."; }
  try {
    const list = asList(await api("/admin/api/images"));
    const root = document.getElementById("imagesRoot");
    if (!root) return;

    if (!list.length) {
      root.innerHTML = '<div class="empty-inline">暂无图片记录</div>';
      return;
    }

    root.innerHTML = `<div class="img-grid">${list.map(image => imageCard(image, ctx)).join("")}</div>`;

    // Bind delete events
    root.querySelectorAll("[data-delete-img]").forEach(btn =>
      btn.addEventListener("click", async () => {
        if (!confirm("确认删除图片文件和记录？")) return;
        await api(`/admin/api/images/${encodeURIComponent(btn.dataset.deleteImg)}`, { method: "DELETE" });
        ctx.toast("图片已删除", "success");
        await loadImages(ctx);
      })
    );

    // Bind copy URL events
    root.querySelectorAll("[data-copy-url]").forEach(btn =>
      btn.addEventListener("click", async () => {
        const url = safeURL(btn.dataset.copyUrl);
        const copied = url ? await writeClipboardText(url) : false;
        ctx.toast(
          copied ? "链接已复制" : "复制失败，请手动复制链接",
          copied ? "success" : "error"
        );
      })
    );
  } finally {
    if (btn) { btn.classList.remove("saving"); btn.textContent = "刷新"; }
  }
}

function imageCard(image, ctx) {
  const publicURL = safeURL(image.public_url);
  const upstreamURL = safeURL(image.upstream_image_url);
  const modelName = image.upstream_model_name || `sd${image.model_index}`;
  const size = image.width && image.height ? `${image.width} × ${image.height}` : "—";
  const time = fmtDate(image.created_at);
  const seed = image.seed ?? "—";

  const preview = publicURL
    ? `<a href="${escapeHTML(publicURL)}" target="_blank" rel="noreferrer" class="img-card-preview"><img src="${escapeHTML(publicURL)}" alt="生成图片" loading="lazy"></a>`
    : '<div class="img-card-placeholder">图片链接无效</div>';

  return `
    <article class="img-card">
      ${preview}
      <div class="img-card-body">
        <div class="img-card-info">
          <strong class="img-card-model">${escapeHTML(modelName)}</strong>
          <span class="img-card-meta">${escapeHTML(size)} · seed ${escapeHTML(seed)}</span>
          <span class="img-card-time">${escapeHTML(time)}</span>
        </div>
        <div class="img-card-actions">
          ${publicURL ? `<button class="button-secondary prompt-card-btn" data-copy-url="${escapeHTML(publicURL)}">复制链接</button>` : ""}
          ${upstreamURL ? `<a href="${escapeHTML(upstreamURL)}" target="_blank" rel="noreferrer" class="button-secondary prompt-card-btn">上游原图</a>` : ""}
          <button class="button-secondary prompt-card-btn btn-danger-text" data-delete-img="${escapeHTML(image.id)}">删除</button>
        </div>
      </div>
    </article>`;
}
