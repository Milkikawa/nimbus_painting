import { api, fmtDate, text } from "../api.js";

const settingIds = [
  "upstream_endpoint",
  "default_model_index",
  "default_width",
  "default_height",
  "default_steps",
  "default_cfg",
  "min_dimension",
  "max_dimension",
  "request_timeout_seconds",
  "image_save_dir",
  "selected_positive_group_id",
  "selected_negative_group_id",
];

export const settingsPage = {
  title: "基础设置",
  eyebrow: "配置",
  async render(ctx) {
    ctx.root.innerHTML = `
      <div class="settings-page-header">
        <div>
          <h2>基础设置</h2>
          <p class="page-desc">配置上游接口、默认生成参数和图片保存目录</p>
        </div>
        <button id="saveSettings" class="btn-save">保存设置</button>
      </div>

      <!-- Section 1: 上游与模型 -->
      <div class="settings-section">
        <div class="settings-section-title">上游与模型</div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="label-main">上游完整接口</div>
            <div class="label-desc">转发绘图请求的真实上游 API 地址</div>
          </div>
          <div class="settings-row-input">
            <input id="upstream_endpoint" placeholder="https://example.com/full/path">
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="label-main">默认模型编号</div>
            <div class="label-desc">请求未指定模型时使用的默认模型 index；请在模型目录中确认该编号存在</div>
          </div>
          <div class="settings-row-input">
            <input id="default_model_index" inputmode="numeric" placeholder="4">
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="label-main">请求超时秒数</div>
            <div class="label-desc">调用上游时的最大等待时间</div>
          </div>
          <div class="settings-row-input">
            <input id="request_timeout_seconds" inputmode="numeric" placeholder="120">
          </div>
        </div>
      </div>

      <!-- Section 2: 默认生成参数 -->
      <div class="settings-section">
        <div class="settings-section-title">默认生成参数</div>
        <div class="settings-grid-2col">
          <div class="settings-row">
            <div class="settings-row-label">
              <div class="label-main">默认宽度</div>
            </div>
            <div class="settings-row-input">
              <input id="default_width" inputmode="numeric" placeholder="832">
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-label">
              <div class="label-main">默认高度</div>
            </div>
            <div class="settings-row-input">
              <input id="default_height" inputmode="numeric" placeholder="1216">
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-label">
              <div class="label-main">采样步数</div>
            </div>
            <div class="settings-row-input">
              <input id="default_steps" inputmode="numeric" placeholder="20">
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-label">
              <div class="label-main">CFG</div>
            </div>
            <div class="settings-row-input">
              <input id="default_cfg" inputmode="decimal" placeholder="7">
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-label">
              <div class="label-main">最小尺寸</div>
            </div>
            <div class="settings-row-input">
              <input id="min_dimension" inputmode="numeric" placeholder="64">
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-label">
              <div class="label-main">最大尺寸</div>
            </div>
            <div class="settings-row-input">
              <input id="max_dimension" inputmode="numeric" placeholder="2048">
            </div>
          </div>
        </div>
      </div>

      <!-- Section 3: 提示词与图片保存 -->
      <div class="settings-section">
        <div class="settings-section-title">提示词与图片保存</div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="label-main">图片保存目录</div>
            <div class="label-desc">本地图片归档的文件系统路径</div>
          </div>
          <div class="settings-row-input">
            <input id="image_save_dir" placeholder="images">
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="label-main">默认正面提示词组</div>
            <div class="label-desc">请求时自动追加的正面提示词</div>
          </div>
          <div class="settings-row-input">
            <select id="selected_positive_group_id"></select>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <div class="label-main">默认负面提示词组</div>
            <div class="label-desc">请求时自动追加的负面提示词</div>
          </div>
          <div class="settings-row-input">
            <select id="selected_negative_group_id"></select>
          </div>
        </div>
      </div>`;

    const saveBtn = document.getElementById("saveSettings");
    let dirty = false;

    // Mark dirty on any input change
    settingIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el)
        el.addEventListener("input", () => {
          if (!dirty) {
            dirty = true;
            saveBtn.classList.add("dirty");
          }
        });
    });

    // Save handler
    saveBtn.addEventListener("click", async () => {
      saveBtn.classList.add("saving");
      saveBtn.textContent = "保存中...";
      try {
        const body = {};
        settingIds.forEach((id) => {
          body[id] = document.getElementById(id).value;
        });
        await api("/admin/api/settings", {
          method: "PUT",
          body: JSON.stringify(body),
        });
        ctx.toast("设置已保存", "success");
        ctx.refreshStatus();
        dirty = false;
        saveBtn.classList.remove("dirty");
      } catch (error) {
        ctx.toast(error.message || "保存失败", "error");
      } finally {
        saveBtn.classList.remove("saving");
        saveBtn.textContent = "保存设置";
      }
    });

    await loadSettingsForm(ctx);
  },
};

export async function loadSettingsForm(ctx) {
  const [settings, groups] = await Promise.all([
    api("/admin/api/settings"),
    api("/admin/api/prompt-groups"),
  ]);
  const positive = document.getElementById("selected_positive_group_id");
  const negative = document.getElementById("selected_negative_group_id");
  positive.innerHTML = '<option value="">不使用</option>';
  negative.innerHTML = '<option value="">不使用</option>';
  groups.forEach((group) => {
    const option = new Option(group.name, group.id);
    (group.type === "positive" ? positive : negative).add(option);
  });
  settingIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = settings[id] ?? "";
  });
}

export async function settingsSummary() {
  const settings = await api("/admin/api/settings");
  return {
    endpoint: settings.upstream_endpoint ? "已配置" : "未配置",
    model: `sd${settings.default_model_index || 4}`,
    size: `${settings.default_width || 832} × ${
      settings.default_height || 1216
    }`,
    updated: text(
      settings.request_timeout_seconds
        ? `${settings.request_timeout_seconds} 秒超时`
        : ""
    ),
  };
}
