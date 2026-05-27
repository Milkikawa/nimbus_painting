import { api, fmtDate, text } from '../api.js';

const settingIds = ['upstream_endpoint','default_model_index','default_width','default_height','default_steps','default_cfg','min_dimension','max_dimension','request_timeout_seconds','image_save_dir','selected_positive_group_id','selected_negative_group_id'];

export const settingsPage = {
  title: '基础设置',
  eyebrow: 'Configuration',
  async render(ctx) {
    ctx.root.innerHTML = `
      <section class="card">
        <div class="card-header"><div><h2>基础参数</h2><p class="muted">配置上游 endpoint、默认生成参数和图片保存目录。</p></div><button id="saveSettings">保存设置</button></div>
        <div class="grid">
          <label class="field"><span>上游完整 Endpoint</span><input id="upstream_endpoint" placeholder="https://example.com/full/path"></label>
          <label class="field"><span>默认模型编号</span><input id="default_model_index" inputmode="numeric"></label>
          <label class="field"><span>默认宽度</span><input id="default_width" inputmode="numeric"></label>
          <label class="field"><span>默认高度</span><input id="default_height" inputmode="numeric"></label>
          <label class="field"><span>Steps</span><input id="default_steps" inputmode="numeric"></label>
          <label class="field"><span>CFG</span><input id="default_cfg" inputmode="decimal"></label>
          <label class="field"><span>最小尺寸</span><input id="min_dimension" inputmode="numeric"></label>
          <label class="field"><span>最大尺寸</span><input id="max_dimension" inputmode="numeric"></label>
          <label class="field"><span>请求超时秒</span><input id="request_timeout_seconds" inputmode="numeric"></label>
          <label class="field"><span>图片保存目录</span><input id="image_save_dir"></label>
          <label class="field"><span>正面提示词组</span><select id="selected_positive_group_id"></select></label>
          <label class="field"><span>负面提示词组</span><select id="selected_negative_group_id"></select></label>
        </div>
      </section>`;
    await loadSettingsForm(ctx);
    document.getElementById('saveSettings').addEventListener('click', async () => {
      const body = {};
      settingIds.forEach((id) => { body[id] = document.getElementById(id).value; });
      await api('/admin/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      ctx.toast('设置已保存', 'success');
      ctx.refreshStatus();
    });
  }
};

export async function loadSettingsForm(ctx) {
  const [settings, groups] = await Promise.all([api('/admin/api/settings'), api('/admin/api/prompt-groups')]);
  const positive = document.getElementById('selected_positive_group_id');
  const negative = document.getElementById('selected_negative_group_id');
  positive.innerHTML = '<option value="">不使用</option>';
  negative.innerHTML = '<option value="">不使用</option>';
  groups.forEach((group) => {
    const option = new Option(group.name, group.id);
    (group.type === 'positive' ? positive : negative).add(option);
  });
  settingIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = settings[id] ?? '';
  });
}

export async function settingsSummary() {
  const settings = await api('/admin/api/settings');
  return {
    endpoint: settings.upstream_endpoint ? '已配置' : '未配置',
    model: `sd${settings.default_model_index || 4}`,
    size: `${settings.default_width || 832} × ${settings.default_height || 1216}`,
    updated: text(settings.request_timeout_seconds ? `${settings.request_timeout_seconds} 秒超时` : '')
  };
}
