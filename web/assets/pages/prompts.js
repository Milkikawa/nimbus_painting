import { api, asList, escapeHTML } from '../api.js';

export const promptsPage = {
  title: '提示词组',
  eyebrow: 'Prompt Groups',
  async render(ctx) {
    ctx.root.innerHTML = `
      <section class="split">
        <form id="groupForm" class="card">
          <h2>编辑提示词组</h2>
          <input id="group_id" type="hidden">
          <label class="field"><span>组名</span><input id="group_name" required></label>
          <label class="field"><span>类型</span><select id="group_type"><option value="positive">正面</option><option value="negative">负面</option></select></label>
          <label class="field"><span>备注</span><input id="group_remark"></label>
          <label class="field"><span>内容</span><textarea id="group_content" placeholder="tag1, tag2, tag3" required></textarea></label>
          <div class="form-actions"><button type="submit">保存</button><button type="button" class="button-secondary" id="resetGroup">清空</button></div>
        </form>
        <section class="card">
          <div class="card-header"><div><h2>预设列表</h2><p class="muted">正面和负面提示词组统一管理。</p></div><button id="reloadGroups" class="button-secondary">刷新</button></div>
          <div id="groupsTable"></div>
        </section>
      </section>`;
    const reload = () => loadGroups(ctx);
    document.getElementById('groupForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = groupFormElements();
      await api('/admin/api/prompt-groups', { method: 'POST', body: JSON.stringify({
        id: form.id.value, name: form.name.value, type: form.type.value, remark: form.remark.value, content: form.content.value
      }) });
      clearForm();
      ctx.toast('提示词组已保存', 'success');
      await reload();
    });
    document.getElementById('resetGroup').addEventListener('click', clearForm);
    document.getElementById('reloadGroups').addEventListener('click', reload);
    await reload();
  }
};

async function loadGroups(ctx) {
  const list = asList(await api('/admin/api/prompt-groups'));
  const container = document.getElementById('groupsTable');
  if (!list.length) {
    container.innerHTML = '<div class="empty">暂无提示词组</div>';
    return;
  }
  container.innerHTML = `<div class="table-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>内容</th><th>操作</th></tr></thead><tbody>${list.map((g) => `
    <tr><td>${escapeHTML(g.name)}</td><td><span class="badge">${g.type === 'positive' ? '正面' : '负面'}</span></td><td>${escapeHTML(g.content)}</td><td><button class="button-secondary" data-edit="${escapeHTML(g.id)}">编辑</button> <button class="button-danger" data-delete="${escapeHTML(g.id)}">删除</button></td></tr>`).join('')}</tbody></table></div>`;
  container.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    const group = list.find((item) => item.id === btn.dataset.edit);
    const form = groupFormElements();
    form.id.value = group.id; form.name.value = group.name; form.type.value = group.type; form.remark.value = group.remark || ''; form.content.value = group.content;
  }));
  container.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('确认删除提示词组？')) return;
    await api(`/admin/api/prompt-groups/${encodeURIComponent(btn.dataset.delete)}`, { method: 'DELETE' });
    ctx.toast('提示词组已删除', 'success');
    await loadGroups(ctx);
  }));
}

function clearForm() {
  const form = groupFormElements();
  form.id.value = ''; form.name.value = ''; form.type.value = 'positive'; form.remark.value = ''; form.content.value = '';
}

function groupFormElements() {
  return {
    id: document.getElementById('group_id'),
    name: document.getElementById('group_name'),
    type: document.getElementById('group_type'),
    remark: document.getElementById('group_remark'),
    content: document.getElementById('group_content')
  };
}
