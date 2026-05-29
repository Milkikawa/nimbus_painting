import { api, asList, escapeHTML, fmtDate } from '../api.js';

export const imagesPage = {
  title: '图片管理',
  eyebrow: '本地图库',
  async render(ctx) {
    ctx.root.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div><h2>图片管理</h2><p class="muted">查看最近 100 张本地归档图片，同时保留上游原图链接和模型信息。</p></div>
          <button id="reloadImages" class="button-secondary">刷新</button>
        </div>
        <div id="imagesRoot"></div>
      </section>`;
    document.getElementById('reloadImages').addEventListener('click', () => loadImages(ctx));
    await loadImages(ctx);
  }
};

async function loadImages(ctx) {
  const list = asList(await api('/admin/api/images'));
  const root = document.getElementById('imagesRoot');
  if (!list.length) {
    root.innerHTML = '<div class="empty">暂无图片记录</div>';
    return;
  }
  root.innerHTML = `<div class="images">${list.map((image) => `
    <article class="image-card">
      <a href="${escapeHTML(image.public_url)}" target="_blank" rel="noreferrer"><img src="${escapeHTML(image.public_url)}" alt="生成图片预览"></a>
      <div class="image-card-body">
        <strong>sd${escapeHTML(image.model_index)} · seed ${escapeHTML(image.seed)}</strong>
        <span class="muted">上游模型：${escapeHTML(image.upstream_model_name || '—')}</span>
        <span class="muted">${escapeHTML(image.width)} × ${escapeHTML(image.height)}</span>
        <span class="muted">${fmtDate(image.created_at)}</span>
        <a href="${escapeHTML(image.upstream_image_url)}" target="_blank" rel="noreferrer">打开上游原图</a>
        <a href="${escapeHTML(image.public_url)}" target="_blank" rel="noreferrer">打开本地归档</a>
        <button class="button-danger" data-delete="${escapeHTML(image.id)}">删除图片</button>
      </div>
    </article>`).join('')}</div>`;
  root.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('确认删除图片文件和记录？')) return;
    await api(`/admin/api/images/${encodeURIComponent(btn.dataset.delete)}`, { method: 'DELETE' });
    ctx.toast('图片已删除', 'success');
    await loadImages(ctx);
  }));
}
