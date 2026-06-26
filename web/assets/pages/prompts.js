import { api, asList, escapeHTML } from '../api.js';

export const promptsPage = {
  title: '提示词组',
  eyebrow: 'Prompt Groups',
  async render(ctx) {
    ctx.root.innerHTML = `
      <div class="settings-page-header">
        <div>
          <h2>提示词组</h2>
          <p class="page-desc">管理请求中自动拼接的正面与负面提示词组</p>
        </div>
        <div class="prompt-header-actions">
          <button id="addPositiveGroup" class="btn-save">新增正面组</button>
          <button id="addNegativeGroup" class="button-secondary">新增负面组</button>
        </div>
      </div>
      <div class="prompt-columns" id="promptsRoot">
        <div class="prompt-col">
          <div class="settings-section">
            <div class="settings-section-title">正面提示词</div>
            <div id="positiveList"><div class="empty-inline">加载中...</div></div>
          </div>
        </div>
        <div class="prompt-col">
          <div class="settings-section">
            <div class="settings-section-title">负面提示词</div>
            <div id="negativeList"><div class="empty-inline">加载中...</div></div>
          </div>
        </div>
      </div>

      <!-- Edit Modal -->
      <div id="promptModal" class="prompt-modal hidden">
        <div class="prompt-modal-backdrop"></div>
        <div class="prompt-modal-panel">
          <div class="prompt-modal-header">
            <h3 id="modalTitle">编辑提示词组</h3>
            <button class="button-secondary" id="closeModal" type="button">关闭</button>
          </div>
          <form id="groupForm" class="prompt-modal-body">
            <input id="group_id" type="hidden">
            <div class="settings-row">
              <div class="settings-row-label"><span class="label-main">组名</span></div>
              <div class="settings-row-input"><input id="group_name" required placeholder="提示词组名称"></div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label"><span class="label-main">类型</span></div>
              <div class="settings-row-input">
                <select id="group_type">
                  <option value="positive">正面</option>
                  <option value="negative">负面</option>
                </select>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label"><span class="label-main">备注</span></div>
              <div class="settings-row-input"><input id="group_remark" placeholder="可选备注"></div>
            </div>
            <div class="prompt-content-field">
              <label class="label-main">内容</label>
              <textarea id="group_content" placeholder="tag1, tag2, tag3..." required></textarea>
            </div>
            <div class="prompt-modal-actions">
              <button type="submit" class="btn-save">保存</button>
              <button type="button" class="button-secondary" id="cancelModal">取消</button>
            </div>
          </form>
        </div>
      </div>`;

    const reload = () => loadGroups(ctx);
    document.getElementById('addPositiveGroup').addEventListener('click', () => openModal('positive'));
    document.getElementById('addNegativeGroup').addEventListener('click', () => openModal('negative'));
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('cancelModal').addEventListener('click', closeModal);
    document.getElementById('promptModal').querySelector('.prompt-modal-backdrop').addEventListener('click', closeModal);
    document.getElementById('groupForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = formElements();
      await api('/admin/api/prompt-groups', { method: 'POST', body: JSON.stringify({
        id: form.id.value, name: form.name.value, type: form.type.value,
        remark: form.remark.value, content: form.content.value
      }) });
      closeModal();
      ctx.toast('提示词组已保存', 'success');
      await reload();
    });
    await reload();
  }
};

async function loadGroups(ctx) {
  const list = asList(await api('/admin/api/prompt-groups'));
  const positive = list.filter(g => g.type === 'positive');
  const negative = list.filter(g => g.type === 'negative');

  const positiveEl = document.getElementById('positiveList');
  const negativeEl = document.getElementById('negativeList');

  positiveEl.innerHTML = positive.length > 0
    ? positive.map(g => groupCard(g)).join('')
    : '<div class="empty-inline">暂无正面提示词组</div>';

  negativeEl.innerHTML = negative.length > 0
    ? negative.map(g => groupCard(g)).join('')
    : '<div class="empty-inline">暂无负面提示词组</div>';

  // Bind events
  document.querySelectorAll('[data-edit-group]').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = list.find(item => item.id === btn.dataset.editGroup);
      if (group) editGroup(group);
    });
  });

  document.querySelectorAll('[data-delete-group]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确认删除提示词组？')) return;
      await api(`/admin/api/prompt-groups/${encodeURIComponent(btn.dataset.deleteGroup)}`, { method: 'DELETE' });
      ctx.toast('提示词组已删除', 'success');
      await loadGroups(ctx);
    });
  });

  document.querySelectorAll('[data-copy-content]').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = list.find(item => item.id === btn.dataset.copyContent);
      if (group) {
        navigator.clipboard.writeText(group.content).then(() => ctx.toast('已复制到剪贴板', 'success')).catch(() => {});
      }
    });
  });
}

function groupCard(group) {
  const contentPreview = (group.content || '').length > 200
    ? group.content.slice(0, 200) + '...'
    : group.content || '';
  const typeBadge = group.type === 'positive'
    ? '<span class="badge-success">正面</span>'
    : '<span class="badge-danger">负面</span>';

  return `
    <div class="prompt-card">
      <div class="prompt-card-header">
        <div class="prompt-card-title">
          <strong>${escapeHTML(group.name)}</strong>
          ${typeBadge}
        </div>
        <div class="prompt-card-actions">
          <button class="button-secondary prompt-card-btn" data-edit-group="${escapeHTML(group.id)}">编辑</button>
          <button class="button-secondary prompt-card-btn" data-copy-content="${escapeHTML(group.id)}">复制</button>
          <button class="button-secondary prompt-card-btn btn-danger-text" data-delete-group="${escapeHTML(group.id)}">删除</button>
        </div>
      </div>
      ${group.remark ? `<div class="prompt-card-remark">${escapeHTML(group.remark)}</div>` : ''}
      <pre class="prompt-card-content">${escapeHTML(contentPreview)}</pre>
    </div>`;
}

function openModal(type = 'positive') {
  const modal = document.getElementById('promptModal');
  const form = formElements();
  form.id.value = '';
  form.name.value = '';
  form.type.value = type;
  form.remark.value = '';
  form.content.value = '';
  document.getElementById('modalTitle').textContent = '新增提示词组';
  modal.classList.remove('hidden');
}

function editGroup(group) {
  const modal = document.getElementById('promptModal');
  const form = formElements();
  form.id.value = group.id;
  form.name.value = group.name;
  form.type.value = group.type;
  form.remark.value = group.remark || '';
  form.content.value = group.content;
  document.getElementById('modalTitle').textContent = '编辑提示词组';
  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('promptModal').classList.add('hidden');
}

function formElements() {
  return {
    id: document.getElementById('group_id'),
    name: document.getElementById('group_name'),
    type: document.getElementById('group_type'),
    remark: document.getElementById('group_remark'),
    content: document.getElementById('group_content')
  };
}
