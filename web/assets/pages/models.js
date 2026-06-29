import { api, asList, escapeHTML } from "../api.js";

const modelTypes = ["image", "video", "edit"];

export const modelsPage = {
  title: "模型目录",
  eyebrow: "Model Catalog",
  async render(ctx) {
    ctx.root.innerHTML = `
      <div class="settings-page-header">
        <div>
          <h2>模型目录</h2>
          <p class="page-desc">维护本地可用模型清单、类型和请求规则</p>
        </div>
        <div class="model-actions">
          <button id="addModel" class="button-secondary" type="button">新增模型</button>
          <button id="saveModels" class="btn-save" type="button">保存目录</button>
        </div>
      </div>

      <div class="model-boundary-note" role="note">
        <strong>使用边界</strong>
        <span>本地模型目录只影响未来请求的模型匹配、展示和规则应用；历史日志与统计中的模型名始终以上游响应的 <code>model_name</code> 为准，不会被此目录重写。</span>
      </div>

      <div class="settings-section models-section">
        <div class="settings-section-title">模型项</div>
        <div id="modelsRoot"><div class="empty-inline">加载中...</div></div>
      </div>`;

    const state = {
      models: normalizeModels(asList(await api("/admin/api/models"))),
    };
    const renderList = () => renderModels(ctx, state);

    document.getElementById("addModel").addEventListener("click", () => {
      state.models.push(createModel(state.models));
      renderList();
    });

    document
      .getElementById("saveModels")
      .addEventListener("click", async () => {
        await saveModels(ctx, state);
      });

    renderList();
  },
};

function normalizeModels(models) {
  return models.map((model, fallbackIndex) => ({
    index: toInteger(model.index, fallbackIndex),
    id: String(model.id ?? ""),
    name: String(model.name ?? ""),
    type: modelTypes.includes(model.type) ? model.type : "image",
    available: model.available !== false,
    rules: {
      force_steps: normalizeForceSteps(model.rules?.force_steps),
      append_default_positive_prompt:
        model.rules?.append_default_positive_prompt !== false,
    },
  }));
}

function createModel(models) {
  const maxIndex = models.reduce(
    (max, model) => Math.max(max, Number(model.index) || 0),
    -1
  );
  const nextIndex = maxIndex + 1;
  return {
    index: nextIndex,
    id: `sd${nextIndex}`,
    name: "",
    type: "image",
    available: true,
    rules: {
      force_steps: null,
      append_default_positive_prompt: true,
    },
  };
}

function renderModels(ctx, state) {
  const root = document.getElementById("modelsRoot");
  if (state.models.length === 0) {
    root.innerHTML =
      '<div class="empty-inline">暂无模型，请点击“新增模型”创建。</div>';
    return;
  }

  root.innerHTML = `
    <div class="models-table-wrap">
      <table class="models-table">
        <thead>
          <tr>
            <th>Index</th>
            <th>ID</th>
            <th>名称</th>
            <th>类型</th>
            <th>启用</th>
            <th>强制步数</th>
            <th>追加默认正面词</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${state.models
            .map((model, rowIndex) => modelRow(model, rowIndex))
            .join("")}
        </tbody>
      </table>
    </div>`;

  root.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", () => updateModelFromInput(state, input));
    input.addEventListener("change", () => updateModelFromInput(state, input));
  });

  root.querySelectorAll("[data-delete-model]").forEach((button) => {
    button.addEventListener("click", () => {
      const rowIndex = Number(button.dataset.deleteModel);
      const model = state.models[rowIndex];
      if (!model) return;
      if (!confirm(`确认删除模型 ${model.name || model.id || model.index}？`))
        return;
      state.models.splice(rowIndex, 1);
      ctx.toast("模型已从本地目录移除，保存后生效", "success");
      renderModels(ctx, state);
    });
  });
}

function modelRow(model, rowIndex) {
  return `
    <tr>
      <td><input class="model-input model-index" data-row="${rowIndex}" data-field="index" inputmode="numeric" value="${escapeHTML(
    model.index
  )}"></td>
      <td><input class="model-input" data-row="${rowIndex}" data-field="id" value="${escapeHTML(
    model.id
  )}" placeholder="sd${escapeHTML(model.index)}"></td>
      <td><input class="model-input" data-row="${rowIndex}" data-field="name" value="${escapeHTML(
    model.name
  )}" placeholder="模型名称"></td>
      <td>
        <select class="model-input" data-row="${rowIndex}" data-field="type">
          ${modelTypes
            .map(
              (type) =>
                `<option value="${type}" ${
                  model.type === type ? "selected" : ""
                }>${type}</option>`
            )
            .join("")}
        </select>
      </td>
      <td class="model-check-cell"><input type="checkbox" data-row="${rowIndex}" data-field="available" ${
    model.available ? "checked" : ""
  }></td>
      <td><input class="model-input model-force-steps" data-row="${rowIndex}" data-field="force_steps" inputmode="numeric" value="${escapeHTML(
    model.rules.force_steps ?? ""
  )}" placeholder="空=不强制"></td>
      <td class="model-check-cell"><input type="checkbox" data-row="${rowIndex}" data-field="append_default_positive_prompt" ${
    model.rules.append_default_positive_prompt ? "checked" : ""
  }></td>
      <td><button class="button-secondary prompt-card-btn btn-danger-text" type="button" data-delete-model="${rowIndex}">删除</button></td>
    </tr>`;
}

function updateModelFromInput(state, input) {
  const model = state.models[Number(input.dataset.row)];
  if (!model) return;

  switch (input.dataset.field) {
    case "index":
      model.index = input.value.trim();
      break;
    case "id":
    case "name":
    case "type":
      model[input.dataset.field] = input.value;
      break;
    case "available":
      model.available = input.checked;
      break;
    case "force_steps":
      model.rules.force_steps = input.value.trim();
      break;
    case "append_default_positive_prompt":
      model.rules.append_default_positive_prompt = input.checked;
      break;
  }
}

async function saveModels(ctx, state) {
  const saveBtn = document.getElementById("saveModels");
  saveBtn.classList.add("saving");
  saveBtn.textContent = "保存中...";
  try {
    const payload = buildPayload(state.models);
    await api("/admin/api/models", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    state.models = normalizeModels(payload);
    renderModels(ctx, state);
    ctx.toast("模型目录已保存", "success");
  } catch (error) {
    ctx.toast(error.message || "保存失败", "error");
  } finally {
    saveBtn.classList.remove("saving");
    saveBtn.textContent = "保存目录";
  }
}

function buildPayload(models) {
  const seen = new Set();
  return models.map((model, rowIndex) => {
    const index = parseRequiredInteger(
      model.index,
      `第 ${rowIndex + 1} 行 index`
    );
    if (seen.has(index)) throw new Error(`模型 index ${index} 重复`);
    seen.add(index);

    const id = String(model.id ?? "").trim();
    const name = String(model.name ?? "").trim();
    const type = String(model.type ?? "").trim();
    if (!id) throw new Error(`第 ${rowIndex + 1} 行 id 不能为空`);
    if (!name) throw new Error(`第 ${rowIndex + 1} 行 name 不能为空`);
    if (!modelTypes.includes(type))
      throw new Error(`第 ${rowIndex + 1} 行 type 无效`);

    return {
      index,
      id,
      name,
      type,
      available: model.available !== false,
      rules: {
        force_steps: parseOptionalPositiveInteger(
          model.rules?.force_steps,
          `第 ${rowIndex + 1} 行 force_steps`
        ),
        append_default_positive_prompt:
          model.rules?.append_default_positive_prompt === true,
      },
    };
  });
}

function parseRequiredInteger(value, label) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${label} 必须是非负整数`);
  return Number(raw);
}

function parseOptionalPositiveInteger(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw) || Number(raw) <= 0)
    throw new Error(`${label} 必须为空或大于 0`);
  return Number(raw);
}

function toInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizeForceSteps(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
