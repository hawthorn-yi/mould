const state = {
  suppliers: [],
  molds: [],
  orders: [],
};

let currentOrder = {
  id: null,
  orderNo: '',
  status: '草稿',
  lines: [],
};

let currentView = 'molds';
let editingMoldId = null;
let editingSupplierId = null;

const supabaseConfig = window.SUPABASE_CONFIG || null;
const SUPABASE_REST_URL = supabaseConfig
  ? `${supabaseConfig.url.replace(/\/+$/, '')}/rest/v1`
  : '';
let supabaseStateCache = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

const materialColorKeywords = [
  ['石墨烯颜色', '#0f766e'],
  ['石墨烯色', '#0f766e'],
  ['黑色', '#111827'],
  ['白色', '#64748b'],
  ['棕色', '#92400e'],
  ['灰色', '#6b7280'],
];

function highlightMaterialName(value) {
  let text = escapeHtml(value);
  for (const [word, color] of materialColorKeywords) {
    text = text.split(word).join(
      `<span class="material-color-word" style="color:${color}">${word}</span>`,
    );
  }
  return text;
}

function statusClass(status) {
  if (status === '在用') return 'status-active';
  if (status === '维修') return 'status-repair';
  return 'status-inactive';
}

function supabaseText(value) {
  return String(value ?? '').trim();
}

async function supabaseFetch(pathname, options = {}) {
  const headers = {
    apikey: supabaseConfig.key,
    Authorization: `Bearer ${supabaseConfig.key}`,
    ...(options.headers || {}),
  };
  const response = await fetch(`${SUPABASE_REST_URL}/${pathname}`, {
    ...options,
    headers,
  });
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message =
      typeof data === 'object' && (data?.message || data?.error)
        ? data.message || data.error
        : `Supabase请求失败(${response.status})`;
    throw new Error(message);
  }
  return data;
}

async function fetchSupabaseState() {
  if (supabaseStateCache) {
    return supabaseStateCache;
  }
  const rows = await supabaseFetch('app_state?id=eq.main&select=data');
  const data = rows?.[0]?.data || { suppliers: [], molds: [], orders: [] };
  supabaseStateCache = data;
  return data;
}

async function saveSupabaseState(data) {
  const normalized = {
    suppliers: Array.isArray(data.suppliers) ? data.suppliers : [],
    molds: Array.isArray(data.molds) ? data.molds : [],
    orders: Array.isArray(data.orders) ? data.orders : [],
  };
  await supabaseFetch('app_state?on_conflict=id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      id: 'main',
      data: normalized,
      updated_at: new Date().toISOString(),
    }),
  });
  supabaseStateCache = normalized;
}

function normalizeSupplier(input, existing = {}) {
  const name = supabaseText(input.name);
  if (!name) {
    throw new Error('供应商名称不能为空');
  }
  return {
    id: existing.id || `sup-${crypto.randomUUID()}`,
    name,
    contact: supabaseText(input.contact),
    phone: supabaseText(input.phone),
    remark: supabaseText(input.remark),
  };
}

function normalizeMold(input, existing = {}) {
  const moldNo = supabaseText(input.moldNo).toUpperCase();
  const supplierId = supabaseText(input.supplierId);
  const status = supabaseText(input.status) || '在用';
  const remark = supabaseText(input.remark);
  const rawItems = Array.isArray(input.items) ? input.items : [];
  const items = [];
  const seen = new Set();

  for (const item of rawItems) {
    const materialNo = supabaseText(item.materialNo).toUpperCase();
    const materialName = supabaseText(item.materialName);
    const cavities = Number(item.cavities);
    if (!materialNo) {
      continue;
    }
    if (seen.has(materialNo)) {
      throw new Error(`物料 ${materialNo} 在同一套模具中重复`);
    }
    if (!Number.isInteger(cavities) || cavities <= 0) {
      throw new Error(`物料 ${materialNo} 的穴数必须是正整数`);
    }
    seen.add(materialNo);
    items.push({
      id: item.id || `item-${crypto.randomUUID()}`,
      materialNo,
      materialName,
      image: typeof item.image === 'string' ? item.image.trim() : '',
      cavities,
    });
  }

  if (!moldNo) {
    throw new Error('模具号不能为空');
  }
  if (!supplierId) {
    throw new Error('请选择供应商');
  }
  if (items.length === 0) {
    throw new Error('至少需要维护一个物料');
  }

  return {
    id: existing.id || `mold-${crypto.randomUUID()}`,
    moldNo,
    supplierId,
    status,
    remark,
    items,
  };
}

function normalizeOrder(input, existing = {}) {
  const orderNo = supabaseText(input.orderNo);
  if (!orderNo) {
    throw new Error('订单号不能为空');
  }
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const lines = [];
  for (const line of rawLines) {
    const materialNo = supabaseText(line.materialNo).toUpperCase();
    const quantity = Number(line.quantity);
    if (!materialNo) {
      throw new Error('订单中存在空物料号');
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`物料 ${materialNo} 的数量必须是正整数`);
    }
    lines.push({
      id: line.id || `line-${crypto.randomUUID()}`,
      materialNo,
      materialName: supabaseText(line.materialName),
      supplierId: supabaseText(line.supplierId),
      quantity,
      moldId: supabaseText(line.moldId),
      remark: supabaseText(line.remark),
    });
  }
  return {
    id: existing.id || `order-${crypto.randomUUID()}`,
    orderNo,
    lines,
    status: supabaseText(input.status) || '草稿',
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function handleSupabaseApi(path, options = {}) {
  const method = options.method || 'GET';
  const rawSegments = String(path).replace(/^\/+/, '').split('/').filter(Boolean);
  const segments = rawSegments[0] === 'api' ? rawSegments.slice(1) : rawSegments;
  const root = segments[0];

  if (root === 'state') {
    if (method === 'GET') {
      return fetchSupabaseState();
    }
    if (method === 'PUT') {
      await saveSupabaseState(options.body || {});
      return options.body || {};
    }
  }

  if (root === 'suppliers') {
    const data = await fetchSupabaseState();
    if (method === 'GET' && segments.length === 1) {
      return data.suppliers;
    }
    if (method === 'POST' && segments.length === 1) {
      const supplier = normalizeSupplier(options.body || {});
      data.suppliers.push(supplier);
      await saveSupabaseState(data);
      return supplier;
    }
    if (segments.length === 2) {
      const id = decodeURIComponent(segments[1]);
      const index = data.suppliers.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new Error('供应商不存在');
      }
      if (method === 'PUT') {
        data.suppliers[index] = normalizeSupplier(
          options.body || {},
          data.suppliers[index],
        );
        await saveSupabaseState(data);
        return data.suppliers[index];
      }
      if (method === 'DELETE') {
        const used = data.molds.some((mold) => mold.supplierId === id);
        if (used) {
          throw new Error('该供应商已被模具使用，不能删除');
        }
        data.suppliers.splice(index, 1);
        await saveSupabaseState(data);
        return null;
      }
    }
  }

  if (root === 'molds') {
    const data = await fetchSupabaseState();
    if (method === 'GET' && segments.length === 1) {
      return data.molds;
    }
    if (method === 'POST' && segments.length === 1) {
      const mold = normalizeMold(options.body || {});
      if (data.molds.some((item) => item.moldNo === mold.moldNo)) {
        throw new Error(`模具号 ${mold.moldNo} 已存在`);
      }
      data.molds.push(mold);
      await saveSupabaseState(data);
      return mold;
    }
    if (segments.length === 2) {
      const id = decodeURIComponent(segments[1]);
      const index = data.molds.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new Error('模具不存在');
      }
      if (method === 'PUT') {
        const mold = normalizeMold(options.body || {}, data.molds[index]);
        const duplicate = data.molds.some(
          (item) => item.moldNo === mold.moldNo && item.id !== mold.id,
        );
        if (duplicate) {
          throw new Error(`模具号 ${mold.moldNo} 已存在`);
        }
        data.molds[index] = mold;
        await saveSupabaseState(data);
        return mold;
      }
      if (method === 'DELETE') {
        data.molds.splice(index, 1);
        await saveSupabaseState(data);
        return null;
      }
    }
  }

  if (root === 'materials' && method === 'GET' && segments.length === 2) {
    const materialNo = supabaseText(decodeURIComponent(segments[1])).toUpperCase();
    const data = await fetchSupabaseState();
    const supplierMap = new Map(
      data.suppliers.map((item) => [item.id, item]),
    );
    return data.molds
      .map((mold) => {
        const item = mold.items.find(
          (line) => line.materialNo === materialNo,
        );
        if (!item) {
          return null;
        }
        const supplier = supplierMap.get(mold.supplierId) || {};
        return {
          moldId: mold.id,
          moldNo: mold.moldNo,
          supplierId: mold.supplierId,
          supplierName: supplier.name || '',
          supplierContact: supplier.contact || '',
          supplierPhone: supplier.phone || '',
          supplierRemark: supplier.remark || '',
          status: mold.status,
          remark: mold.remark,
          cavities: item.cavities,
          moldItems: mold.items,
        };
      })
      .filter(Boolean);
  }

  if (root === 'orders') {
    const data = await fetchSupabaseState();
    if (method === 'GET' && segments.length === 1) {
      return data.orders;
    }
    if (method === 'POST' && segments.length === 1) {
      const order = normalizeOrder(options.body || {});
      if (data.orders.some((item) => item.orderNo === order.orderNo)) {
        throw new Error(`订单号 ${order.orderNo} 已存在`);
      }
      data.orders.unshift(order);
      await saveSupabaseState(data);
      return order;
    }
    if (segments.length === 2) {
      const id = decodeURIComponent(segments[1]);
      const index = data.orders.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new Error('订单不存在');
      }
      if (method === 'PUT') {
        const order = normalizeOrder(options.body || {}, data.orders[index]);
        const duplicate = data.orders.some(
          (item) => item.orderNo === order.orderNo && item.id !== order.id,
        );
        if (duplicate) {
          throw new Error(`订单号 ${order.orderNo} 已存在`);
        }
        data.orders[index] = order;
        await saveSupabaseState(data);
        return order;
      }
      if (method === 'DELETE') {
        data.orders.splice(index, 1);
        await saveSupabaseState(data);
        return null;
      }
    }
  }

  throw new Error('接口不存在');
}

async function api(path, options = {}) {
  if (supabaseConfig) {
    return handleSupabaseApi(path, options);
  }
  const config = {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  };
  if (options.body) {
    config.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, config);
  if (response.status === 204) {
    return null;
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || '请求失败');
  }
  return data;
}

function showToast(message, type = 'success') {
  const container = $('#toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

function refreshIcons(root = document) {
  if (window.lucide) {
    window.lucide.createIcons({ root });
  }
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function supplierName(supplierId) {
  return state.suppliers.find((item) => item.id === supplierId)?.name || '未设置';
}

function moldsForMaterial(materialNo) {
  const code = String(materialNo || '').trim().toUpperCase();
  if (!code) return [];
  return state.molds.filter((mold) =>
    mold.items.some((item) => item.materialNo === code)
  );
}

function materialNameForMaterial(materialNo, moldId = '') {
  const code = String(materialNo || '').trim().toUpperCase();
  if (!code) return '';
  const candidates = moldsForMaterial(code);
  const mold = moldId
    ? candidates.find((item) => item.id === moldId)
    : candidates[0];
  return mold?.items.find((item) => item.materialNo === code)?.materialName || '';
}

function getMoldById(moldId) {
  return state.molds.find((mold) => mold.id === moldId) || null;
}

function sortedMoldItems(mold) {
  return [...(mold.items || [])].sort((a, b) =>
    a.materialNo.localeCompare(b.materialNo, 'zh-CN'),
  );
}

function switchView(view) {
  currentView = view;
  $$('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  $$('.view').forEach((section) => {
    section.classList.toggle('active', section.id === `view-${view}`);
  });
}

function openModal({ title, body, footer = '', onMount = null, width = 720 }) {
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="width:min(${width}px,100%)">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button class="icon-button" data-close-modal aria-label="关闭">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">${footer}</div>
      </div>
    </div>
  `;
  $('[data-close-modal]', root).addEventListener('click', closeModal);
  root.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-backdrop')) {
      closeModal();
    }
  });
  refreshIcons(root);
  if (onMount) onMount(root);
}

function closeModal() {
  $('#modalRoot').innerHTML = '';
}

function openImageModal(src, title) {
  openModal({
    title: title || '模具图片',
    body: `<img class="modal-image-full" src="${escapeAttr(src)}" alt="${escapeAttr(title || '模具图片')}" />`,
    width: 960,
  });
}

async function uploadMoldImage(file) {
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) {
    showToast('图片不能超过 3MB', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    const moldId = $('#imageInput').dataset.moldId;
    const materialNo = $('#imageInput').dataset.materialNo;
    const mold = getMoldById(moldId);
    if (!mold) return;
    const items = mold.items.map((item) =>
      item.materialNo === materialNo
        ? { ...item, image: reader.result }
        : item,
    );
    try {
      await api(`api/molds/${encodeURIComponent(mold.id)}`, {
        method: 'PUT',
        body: {
          moldNo: mold.moldNo,
          supplierId: mold.supplierId,
          status: mold.status,
          remark: mold.remark,
          items,
        },
      });
      await loadState();
      renderMolds();
      showToast('图片已上传');
    } catch (error) {
      showToast(error.message, 'error');
    }
  };
  reader.readAsDataURL(file);
}

async function loadState() {
  const data = await api('api/state');
  state.suppliers = data.suppliers || [];
  state.molds = data.molds || [];
  state.orders = data.orders || [];
}

function renderMolds() {
  const search = String($('#moldSearch').value || '').trim().toLowerCase();
  const status = $('#moldStatusFilter').value;
  const rows = state.molds
    .map((mold) => ({
      mold,
      items: sortedMoldItems(mold),
      firstMaterialNo: sortedMoldItems(mold)[0]?.materialNo || '',
    }))
    .filter(({ mold }) => {
      const matchText = [
        mold.moldNo,
        supplierName(mold.supplierId),
        ...mold.items.map((item) => item.materialNo),
        ...mold.items.map((item) => item.materialName),
      ]
        .join(' ')
        .toLowerCase();
      const matchSearch = !search || matchText.includes(search);
      const matchStatus = !status || mold.status === status;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      const supplierCompare = supplierName(a.mold.supplierId).localeCompare(
        supplierName(b.mold.supplierId),
        'zh-CN',
      );
      if (supplierCompare !== 0) return supplierCompare;
      const materialCompare = a.firstMaterialNo.localeCompare(
        b.firstMaterialNo,
        'zh-CN',
      );
      if (materialCompare !== 0) return materialCompare;
      return a.mold.moldNo.localeCompare(b.mold.moldNo, 'zh-CN');
    });

  const body = $('#moldTableBody');
  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty-state">没有找到匹配的模具资料</div></td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(({ mold, items }) => {
      const materialDetail = items
        .map(
          (item) => `
            <div class="material-detail-row">
              <div class="material-detail-code"><strong>${escapeHtml(item.materialNo)}</strong></div>
              <div class="material-detail-name">${highlightMaterialName(item.materialName) || '<span class="empty-cell">-</span>'}</div>
              <div class="material-detail-cavity">${escapeHtml(item.cavities)} 出</div>
            </div>
          `,
        )
        .join('');
      const materialImages = items
        .map(
          (item) => `
            <div class="material-image-line">
              ${
                item.image
                  ? `<button class="mold-image-button" data-item-image-mold="${escapeAttr(mold.id)}" data-item-image-no="${escapeAttr(item.materialNo)}" aria-label="查看或替换图片"><img class="mold-thumb" src="${escapeAttr(item.image)}" alt="${escapeAttr(item.materialNo)} 图片" /></button>`
                  : `<button class="button button-secondary button-small" data-item-image-mold="${escapeAttr(mold.id)}" data-item-image-no="${escapeAttr(item.materialNo)}"><i data-lucide="image-plus"></i><span>上传</span></button>`
              }
            </div>
          `,
        )
        .join('');
      return `
        <tr>
          <td class="mold-no-cell"><strong>${escapeHtml(mold.moldNo)}</strong></td>
          <td class="mold-supplier-cell">${escapeHtml(supplierName(mold.supplierId))}</td>
          <td><span class="status-badge ${statusClass(mold.status)}">${escapeHtml(mold.status)}</span></td>
          <td colspan="3" class="material-detail-cell">${materialDetail}</td>
          <td>${escapeHtml(mold.remark) || '<span class="empty-cell">-</span>'}</td>
          <td class="material-images-cell">${materialImages}</td>
          <td class="actions-col">
            <div class="cell-actions">
              <button class="icon-button" data-edit-mold="${escapeAttr(mold.id)}" aria-label="编辑">
                <i data-lucide="pencil"></i>
              </button>
              <button class="icon-button danger" data-delete-mold="${escapeAttr(mold.id)}" aria-label="删除">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  $$('[data-edit-mold]', body).forEach((button) => {
    button.addEventListener('click', () => {
      const mold = getMoldById(button.dataset.editMold);
      if (mold) openMoldModal(mold);
    });
  });
  $$('[data-delete-mold]', body).forEach((button) => {
    button.addEventListener('click', async () => {
      const mold = getMoldById(button.dataset.deleteMold);
      if (!mold) return;
      const ok = window.confirm(`确认删除模具 ${mold.moldNo} 吗？`);
      if (!ok) return;
      await api(`api/molds/${encodeURIComponent(mold.id)}`, { method: 'DELETE' });
      await loadState();
      renderMolds();
      showToast(`已删除模具 ${mold.moldNo}`);
    });
  });
  $$('[data-item-image-mold]', body).forEach((button) => {
    button.addEventListener('click', () => {
      const mold = getMoldById(button.dataset.itemImageMold);
      if (!mold) return;
      const item = mold.items.find(
        (entry) => entry.materialNo === button.dataset.itemImageNo,
      );
      if (!item) return;
      if (item.image) {
        openImageModal(item.image, `${mold.moldNo} / ${item.materialNo}`);
        return;
      }
      $('#imageInput').dataset.moldId = mold.id;
      $('#imageInput').dataset.materialNo = item.materialNo;
      $('#imageInput').click();
    });
  });
  refreshIcons(body);
}

function renderSupplierOptions(selectedId) {
  return state.suppliers
    .map(
      (supplier) =>
        `<option value="${escapeAttr(supplier.id)}" ${supplier.id === selectedId ? 'selected' : ''}>${escapeHtml(supplier.name)}</option>`,
    )
    .join('');
}

function orderSupplierOptionsHtml(selectedId) {
  return `<option value="">请选择供应商</option>${renderSupplierOptions(selectedId)}`;
}

function moldItemEditorHtml(items = []) {
  const rows = items.length
    ? items
    : [{ id: null, materialNo: '', materialName: '', image: '', cavities: '' }];
  return rows
    .map(
      (item) => `
        <div class="item-editor">
          <input class="item-image" type="hidden" value="${escapeAttr(item.image || '')}" />
          <input class="item-material" type="text" value="${escapeAttr(item.materialNo)}" placeholder="物料编码" />
          <input class="item-name" type="text" value="${escapeAttr(item.materialName)}" placeholder="物料名称" />
          <input class="item-cavities" type="number" min="1" step="1" value="${escapeAttr(item.cavities)}" placeholder="穴数" />
          <button class="icon-button danger remove-item" type="button" aria-label="删除物料">
            <i data-lucide="x"></i>
          </button>
        </div>
      `,
    )
    .join('');
}

function openMoldModal(mold = null) {
  editingMoldId = mold?.id || null;
  const title = mold ? `编辑模具 ${mold.moldNo}` : '新增模具';
  const body = `
    <div class="form-grid">
      <label class="field">
        <span>模具号</span>
        <input id="modalMoldNo" type="text" value="${escapeAttr(mold?.moldNo || '')}" placeholder="例如 A" />
      </label>
      <label class="field">
        <span>供应商</span>
        <select id="modalSupplierId">${renderSupplierOptions(mold?.supplierId || '')}</select>
      </label>
      <label class="field">
        <span>模具状态</span>
        <select id="modalMoldStatus">
          ${['在用', '维修', '停用']
            .map(
              (status) =>
                `<option value="${status}" ${mold?.status === status ? 'selected' : ''}>${status}</option>`,
            )
            .join('')}
        </select>
      </label>
      <label class="field">
        <span>备注</span>
        <input id="modalMoldRemark" type="text" value="${escapeAttr(mold?.remark || '')}" placeholder="选填" />
      </label>
      <div class="field full">
        <span>物料编码、名称与穴数</span>
        <div id="modalMoldItems">${moldItemEditorHtml(mold?.items || [])}</div>
        <button id="btnAddMoldItem" class="button button-secondary button-small" type="button">
          <i data-lucide="plus"></i>
          <span>增加物料</span>
        </button>
      </div>
    </div>
  `;
  const footer = `
    <button class="button button-secondary" data-close-modal>取消</button>
    <button id="btnSaveMold" class="button button-primary">
      <i data-lucide="save"></i>
      <span>保存模具</span>
    </button>
  `;
  openModal({
    title,
    body,
    footer,
    onMount(root) {
      const addItem = () => {
        const container = $('#modalMoldItems', root);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = moldItemEditorHtml();
        container.appendChild(wrapper.firstElementChild);
        refreshIcons(container);
      };
      $('#btnAddMoldItem', root).addEventListener('click', addItem);
      $('#modalMoldItems', root).addEventListener('click', (event) => {
        const removeButton = event.target.closest('.remove-item');
        if (!removeButton) return;
        const editors = $$('.item-editor', $('#modalMoldItems', root));
        if (editors.length <= 1) {
          showToast('至少保留一个物料', 'error');
          return;
        }
        removeButton.closest('.item-editor').remove();
      });
      $('#btnSaveMold', root).addEventListener('click', async () => {
        try {
          const items = $$('.item-editor', $('#modalMoldItems', root)).map((row) => ({
            materialNo: $('.item-material', row).value,
            materialName: $('.item-name', row).value,
            image: $('.item-image', row).value,
            cavities: $('.item-cavities', row).value,
          }));
          const payload = {
            moldNo: $('#modalMoldNo', root).value,
            supplierId: $('#modalSupplierId', root).value,
            status: $('#modalMoldStatus', root).value,
            remark: $('#modalMoldRemark', root).value,
            items,
          };
          if (editingMoldId) {
            await api(`api/molds/${encodeURIComponent(editingMoldId)}`, {
              method: 'PUT',
              body: payload,
            });
            showToast('模具已更新');
          } else {
            await api('api/molds', {
              method: 'POST',
              body: payload,
            });
            showToast('模具已新增');
          }
          closeModal();
          await loadState();
          renderMolds();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
      refreshIcons(root);
    },
  });
}

function supplierFormHtml(supplier = null) {
  return `
    <div class="form-grid">
      <label class="field">
        <span>供应商名称</span>
        <input id="supplierName" type="text" value="${escapeAttr(supplier?.name || '')}" placeholder="例如 供应商甲" />
      </label>
      <label class="field">
        <span>联系人</span>
        <input id="supplierContact" type="text" value="${escapeAttr(supplier?.contact || '')}" placeholder="选填" />
      </label>
      <label class="field">
        <span>联系电话</span>
        <input id="supplierPhone" type="text" value="${escapeAttr(supplier?.phone || '')}" placeholder="选填" />
      </label>
      <label class="field">
        <span>备注</span>
        <input id="supplierRemark" type="text" value="${escapeAttr(supplier?.remark || '')}" placeholder="选填" />
      </label>
    </div>
  `;
}

function openSuppliersModal() {
  const renderSupplierList = (root) => {
    const container = $('#supplierList', root);
    container.innerHTML = state.suppliers
      .map(
        (supplier) => `
          <div class="supplier-row">
            <div class="supplier-main">
              <strong>${escapeHtml(supplier.name)}</strong>
              <span>${escapeHtml(supplier.contact || '-')} / ${escapeHtml(supplier.phone || '-')}</span>
            </div>
            <div class="cell-actions">
              <button class="icon-button" data-edit-supplier="${escapeAttr(supplier.id)}" aria-label="编辑">
                <i data-lucide="pencil"></i>
              </button>
              <button class="icon-button danger" data-delete-supplier="${escapeAttr(supplier.id)}" aria-label="删除">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>
        `,
      )
      .join('');
    refreshIcons(container);
  };

  const body = `
    <div id="supplierList" class="supplier-list"></div>
    <div class="section-heading" style="margin-top:18px">
      <div><h3 id="supplierFormTitle">新增供应商</h3></div>
    </div>
    ${supplierFormHtml()}
  `;
  const footer = `
    <button class="button button-secondary" data-close-modal>关闭</button>
    <button id="btnSaveSupplier" class="button button-primary">
      <i data-lucide="save"></i>
      <span>保存供应商</span>
    </button>
  `;
  openModal({
    title: '供应商管理',
    body,
    footer,
    width: 640,
    onMount(root) {
      renderSupplierList(root);
      root.addEventListener('click', (event) => {
        const editButton = event.target.closest('[data-edit-supplier]');
        if (editButton) {
          editingSupplierId = editButton.dataset.editSupplier;
          const supplier = state.suppliers.find((item) => item.id === editingSupplierId);
          $('#supplierFormTitle', root).textContent = '编辑供应商';
          $('#supplierName', root).value = supplier?.name || '';
          $('#supplierContact', root).value = supplier?.contact || '';
          $('#supplierPhone', root).value = supplier?.phone || '';
          $('#supplierRemark', root).value = supplier?.remark || '';
        }
        const deleteButton = event.target.closest('[data-delete-supplier]');
        if (deleteButton) {
          const supplier = state.suppliers.find((item) => item.id === deleteButton.dataset.deleteSupplier);
          if (!supplier) return;
          if (!window.confirm(`确认删除供应商 ${supplier.name} 吗？`)) return;
          api(`api/suppliers/${encodeURIComponent(supplier.id)}`, { method: 'DELETE' })
            .then(async () => {
              await loadState();
              renderSupplierList(root);
              showToast('供应商已删除');
            })
            .catch((error) => showToast(error.message, 'error'));
        }
      });
      $('#btnSaveSupplier', root).addEventListener('click', async () => {
        try {
          const payload = {
            name: $('#supplierName', root).value,
            contact: $('#supplierContact', root).value,
            phone: $('#supplierPhone', root).value,
            remark: $('#supplierRemark', root).value,
          };
          if (editingSupplierId) {
            await api(`api/suppliers/${encodeURIComponent(editingSupplierId)}`, {
              method: 'PUT',
              body: payload,
            });
            showToast('供应商已更新');
          } else {
            await api('api/suppliers', {
              method: 'POST',
              body: payload,
            });
            showToast('供应商已新增');
          }
          editingSupplierId = null;
          await loadState();
          renderSupplierList(root);
          $('#supplierFormTitle', root).textContent = '新增供应商';
          $('#supplierName', root).value = '';
          $('#supplierContact', root).value = '';
          $('#supplierPhone', root).value = '';
          $('#supplierRemark', root).value = '';
          renderMolds();
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    },
  });
}

function resetOrder() {
  currentOrder = {
    id: null,
    orderNo: '',
    status: '草稿',
    lines: [],
  };
  $('#orderNoInput').value = '';
  renderOrderLines();
  $('#orderResult').className = 'result-panel empty';
  $('#orderResult').innerHTML = '<p>录入明细后点击“校验订单”，系统会在这里给出提示。</p>';
}

function addOrderLine(line = {}) {
  const newLine = {
    id: line.id || `line-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    materialNo: line.materialNo || '',
    materialName: line.materialName || '',
    supplierId: line.supplierId || '',
    quantity: line.quantity || '',
    moldId: line.moldId || '',
    remark: line.remark || '',
  };
  currentOrder.lines.push(newLine);
  renderOrderLines();
  const rows = $$('.order-line-row');
  const lastRow = rows[rows.length - 1];
  if (lastRow) {
    $('.line-material', lastRow)?.focus();
  }
}

function moldOptionsHtml(line) {
  const candidates = moldsForMaterial(line.materialNo).filter(
    (mold) => !line.supplierId || mold.supplierId === line.supplierId,
  );
  const options = candidates
    .map(
      (mold) =>
        `<option value="${escapeAttr(mold.id)}" ${line.moldId === mold.id ? 'selected' : ''}>${escapeHtml(mold.moldNo)}</option>`,
    )
    .join('');
  const placeholder =
    candidates.length > 1
      ? '<option value="">请选择模具</option>'
      : candidates.length === 1
        ? ''
        : '<option value="">未维护模具</option>';
  return placeholder + options;
}

function renderOrderLines() {
  const body = $('#orderLineBody');
  if (currentOrder.lines.length === 0) {
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state">还没有订单明细，点击“新增明细”开始录入。</div></td></tr>`;
    return;
  }
  body.innerHTML = currentOrder.lines
    .map(
      (line, index) => `
        <tr class="order-line-row" data-index="${index}">
          <td>
            <input class="line-material" type="text" value="${escapeAttr(line.materialNo)}" placeholder="物料料号" />
          </td>
          <td>
            <input class="line-material-name" type="text" value="${escapeAttr(line.materialName)}" placeholder="自动带出" />
          </td>
          <td>
            <input class="line-quantity" type="number" min="1" step="1" value="${escapeAttr(line.quantity)}" placeholder="数量" />
          </td>
          <td>
            <select class="line-supplier">${orderSupplierOptionsHtml(line.supplierId)}</select>
          </td>
          <td>
            <select class="line-mold">${moldOptionsHtml(line)}</select>
          </td>
          <td>
            <input class="line-remark" type="text" value="${escapeAttr(line.remark)}" placeholder="选填" />
          </td>
          <td class="actions-col">
            <div class="cell-actions">
              <button class="icon-button danger" data-remove-line="${index}" aria-label="删除明细">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `,
    )
    .join('');
  refreshIcons(body);
}

function readOrderLinesFromDom() {
  return $$('.order-line-row').map((row, index) => ({
    index,
    id: currentOrder.lines[index]?.id || `line-${Date.now()}-${index}`,
    materialNo: String($('.line-material', row)?.value || '').trim().toUpperCase(),
    materialName: String($('.line-material-name', row)?.value || '').trim(),
    supplierId: $('.line-supplier', row)?.value || '',
    quantity: Number($('.line-quantity', row)?.value || 0),
    quantityText: String($('.line-quantity', row)?.value || '').trim(),
    moldId: $('.line-mold', row)?.value || '',
    remark: String($('.line-remark', row)?.value || '').trim(),
  }));
}

function openMoldChoice(lineIndex, candidates) {
  const line = currentOrder.lines[lineIndex];
  if (!line) return;
  const body = `
    <div class="mold-choice-grid">
      ${candidates
        .map(
          (mold) => `
            <div class="mold-choice">
              <div class="mold-choice-head">
                <div class="mold-choice-title">模具 ${escapeHtml(mold.moldNo)}</div>
                <span class="status-badge ${statusClass(mold.status)}">${escapeHtml(mold.status)}</span>
              </div>
              <div class="mold-choice-meta">供应商：${escapeHtml(supplierName(mold.supplierId))}</div>
              <div class="material-chips" style="margin-top:10px">
                ${mold.items
                  .map(
                    (item) =>
                      `<span class="chip"><strong>${escapeHtml(item.materialNo)}</strong><span>${escapeHtml(item.cavities)} 出</span></span>`,
                  )
                  .join('')}
              </div>
              <button class="button button-primary button-small" style="margin-top:12px" data-choose-mold="${escapeAttr(mold.id)}">
                <i data-lucide="check"></i>
                <span>选择这套模具</span>
              </button>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
  openModal({
    title: `请选择生产 ${escapeHtml(line.materialNo)} 的模具`,
    body,
    width: 680,
    onMount(root) {
      $$('[data-choose-mold]', root).forEach((button) => {
        button.addEventListener('click', () => {
          currentOrder.lines[lineIndex].moldId = button.dataset.chooseMold;
          closeModal();
          renderOrderLines();
        });
      });
      refreshIcons(root);
    },
  });
}

function updateMoldSelectForRow(row) {
  const index = Number(row.dataset.index);
  const line = currentOrder.lines[index];
  if (!line) return;
  const materialNo = String($('.line-material', row).value || '').trim().toUpperCase();
  const supplierSelect = $('.line-supplier', row);
  const allCandidates = moldsForMaterial(materialNo);
  const uniqueSupplierIds = [...new Set(allCandidates.map((mold) => mold.supplierId))];
  let supplierId = supplierSelect?.value || '';

  if (uniqueSupplierIds.length === 1) {
    supplierId = uniqueSupplierIds[0];
  } else if (uniqueSupplierIds.length > 1 && !uniqueSupplierIds.includes(supplierId)) {
    supplierId = '';
  } else if (uniqueSupplierIds.length === 0) {
    supplierId = '';
  }

  line.materialNo = materialNo;
  line.supplierId = supplierId;
  const candidates = moldsForMaterial(materialNo).filter(
    (mold) => !supplierId || mold.supplierId === supplierId,
  );
  const select = $('.line-mold', row);
  const nameInput = $('.line-material-name', row);

  if (supplierSelect) {
    supplierSelect.value = supplierId;
  }

  if (!supplierId && uniqueSupplierIds.length > 1) {
    line.moldId = '';
  } else if (candidates.length === 1) {
    line.moldId = candidates[0].id;
  } else if (candidates.length > 1) {
    if (!candidates.some((mold) => mold.id === line.moldId)) {
      line.moldId = candidates[0].id;
    }
  }
  if (candidates.length === 0) {
    line.moldId = '';
  }

  select.innerHTML = moldOptionsHtml(line);
  if (line.moldId) {
    select.value = line.moldId;
  }

  const autoName =
    materialNameForMaterial(materialNo, line.moldId) ||
    allCandidates[0]?.items.find((item) => item.materialNo === materialNo)?.materialName;
  if (autoName) {
    if (nameInput) nameInput.value = autoName;
    line.materialName = autoName;
  } else if (nameInput) {
    line.materialName = String(nameInput.value || '').trim();
  }

}

function validationResults(lines) {
  const results = [];
  const missingMap = new Map();

  for (const line of lines) {
    if (!line.materialNo) {
      results.push({
        type: 'error',
        text: `第 ${line.index + 1} 行未填写物料料号。`,
      });
      continue;
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      results.push({
        type: 'error',
        text: `物料 ${line.materialNo} 的数量必须填写正整数。`,
      });
      continue;
    }

    const candidates = moldsForMaterial(line.materialNo);
    if (candidates.length === 0) {
      results.push({
        type: 'error',
        text: `物料 ${line.materialNo} 未维护任何模具，请先在“模具资料”中补充。`,
      });
      continue;
    }

    if (candidates.length > 1 && !line.moldId) {
      results.push({
        type: 'warning',
        text: `物料 ${line.materialNo} 有多套模具，请选择使用哪套模具。`,
      });
      continue;
    }

    const mold = getMoldById(line.moldId) || candidates[0];
    const currentItem = mold.items.find((item) => item.materialNo === line.materialNo);
    if (!currentItem) {
      results.push({
        type: 'error',
        text: `模具 ${mold.moldNo} 中没有维护物料 ${line.materialNo}。`,
      });
      continue;
    }

    for (const companion of mold.items) {
      if (companion.materialNo === line.materialNo) continue;
      const expected = Math.round((line.quantity / currentItem.cavities) * companion.cavities);
      const existingLine = lines.find(
        (other) => other.index !== line.index && other.materialNo === companion.materialNo,
      );

      if (!existingLine) {
        const key = `missing:${mold.id}:${companion.materialNo}`;
        if (!missingMap.has(key)) {
          missingMap.set(key, {
            moldId: mold.id,
            moldNo: mold.moldNo,
            materialNo: companion.materialNo,
            expected,
            sourceMaterial: line.materialNo,
          });
          results.push({
            type: 'missing',
            text: `物料 ${companion.materialNo} 与 ${line.materialNo} 是同一套模具（${mold.moldNo}），请配套下单，建议数量 ${expected}。`,
            moldNo: mold.moldNo,
            materialNo: companion.materialNo,
            expected,
          });
        }
      } else if (
        (!existingLine.moldId || existingLine.moldId === mold.id) &&
        existingLine.quantity !== expected
      ) {
        results.push({
          type: 'warning',
          text: `物料 ${companion.materialNo} 按模具 ${mold.moldNo} 的穴数应下 ${expected}，当前订单实际为 ${existingLine.quantity}，请确认。`,
        });
      }
    }
  }

  return { results, missing: Array.from(missingMap.values()) };
}

function calculateValidation(lines) {
  const errors = [];
  const groupMap = new Map();

  for (const line of lines) {
    const index = line.index;
    if (!line.materialNo) {
      errors.push({ index, text: `第 ${index + 1} 行未填写物料料号。` });
      continue;
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      errors.push({
        index,
        text: `物料 ${line.materialNo} 的数量必须填写正整数。`,
      });
      continue;
    }
    if (!line.supplierId) {
      errors.push({
        index,
        text: `物料 ${line.materialNo} 未选择供应商。`,
      });
      continue;
    }

    const supplier = state.suppliers.find((item) => item.id === line.supplierId);
    if (!supplier) {
      errors.push({
        index,
        text: `物料 ${line.materialNo} 的供应商未维护。`,
      });
      continue;
    }

    const candidates = moldsForMaterial(line.materialNo).filter(
      (mold) => mold.supplierId === line.supplierId,
    );
    if (candidates.length === 0) {
      errors.push({
        index,
        text: `物料 ${line.materialNo} 在供应商“${supplier.name}”下没有对应模具。`,
      });
      continue;
    }

    const moldId =
      line.moldId && candidates.some((mold) => mold.id === line.moldId)
        ? line.moldId
        : candidates[0].id;
    const mold = getMoldById(moldId);
    const item = mold?.items.find((entry) => entry.materialNo === line.materialNo);
    if (!mold || !item) {
      errors.push({
        index,
        text: `模具 ${mold?.moldNo || ''} 中没有维护物料 ${line.materialNo}。`,
      });
      continue;
    }

    let group = groupMap.get(mold.id);
    if (!group) {
      group = {
        mold,
        supplier,
        materialMap: new Map(),
        lineIndices: new Set(),
      };
      groupMap.set(mold.id, group);
    }

    group.lineIndices.add(index);
    const existing = group.materialMap.get(line.materialNo);
    if (existing) {
      existing.quantity += line.quantity;
      existing.lineIndices.push(index);
      if (!existing.remark && line.remark) {
        existing.remark = line.remark;
      }
    } else {
      group.materialMap.set(line.materialNo, {
        materialNo: line.materialNo,
        materialName: line.materialName || item.materialName,
        quantity: line.quantity,
        remark: line.remark || '',
        lineIndices: [index],
      });
    }
  }

  const groups = [];
  for (const group of groupMap.values()) {
    let maxShots = 0;
    const drivers = [];

    for (const merged of group.materialMap.values()) {
      const item = group.mold.items.find((entry) => entry.materialNo === merged.materialNo);
      if (!item) continue;
      const shots = Math.ceil(merged.quantity / item.cavities);
      if (shots > maxShots) {
        maxShots = shots;
        drivers.splice(0, drivers.length, {
          materialNo: merged.materialNo,
          quantity: merged.quantity,
          cavities: item.cavities,
          shots,
        });
      } else if (shots === maxShots) {
        drivers.push({
          materialNo: merged.materialNo,
          quantity: merged.quantity,
          cavities: item.cavities,
          shots,
        });
      }
    }

    const driverText = drivers
      .map(
        (driver) =>
          `${driver.materialNo}（${driver.quantity} 个 / ${driver.cavities} 出 = ${driver.shots} 次）`,
      )
      .join('、');

    const items = group.mold.items.map((item) => {
      const merged = group.materialMap.get(item.materialNo);
      const orderedQty = merged ? merged.quantity : 0;
      const recommendedQty = maxShots * item.cavities;
      const status =
        orderedQty === recommendedQty
          ? 'ok'
          : orderedQty === 0
            ? 'missing'
            : 'adjust';
      const reason =
        item.status === 'ok'
          ? `本模具最大开合 ${maxShots} 次，${item.cavities} 出 × ${maxShots} 次 = ${recommendedQty} 个，当前数量一致。`
          : `本模具以 ${driverText} 为最大开合 ${maxShots} 次，${item.materialNo} 为 ${item.cavities} 出，按 ${item.cavities} 出 × ${maxShots} 次 = ${recommendedQty} 个。`;
      return {
        materialNo: item.materialNo,
        materialName: item.materialName,
        cavities: item.cavities,
        orderedQty,
        recommendedQty,
        status,
        remark: merged?.remark || '',
        reason,
      };
    });

    groups.push({
      mold: group.mold,
      supplier: group.supplier,
      maxShots,
      drivers,
      items,
      lineIndices: Array.from(group.lineIndices),
      hasChanges: items.some((item) => item.status !== 'ok'),
    });
  }

  return {
    groups,
    errors,
    hasChanges: groups.some((group) => group.hasChanges) || errors.length > 0,
  };
}

function applyValidationSuggestions() {
  const lines = readOrderLinesFromDom();
  const { groups, errors } = calculateValidation(lines);
  if (groups.length === 0) {
    showToast(errors.length > 0 ? '请先处理错误后再补足' : '没有可补足的模具明细', 'error');
    return;
  }

  const validIndices = new Set();
  groups.forEach((group) => {
    group.lineIndices.forEach((index) => validIndices.add(index));
  });

  const untouched = lines
    .filter((line, index) => !validIndices.has(index))
    .map((line) => ({ ...line }));

  const rebuilt = [];
  for (const group of groups) {
    for (const item of group.items) {
      rebuilt.push({
        id: `line-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        materialNo: item.materialNo,
        materialName: item.materialName,
        supplierId: group.mold.supplierId,
        quantity: item.recommendedQty,
        moldId: group.mold.id,
        remark: item.remark,
      });
    }
  }

  currentOrder.lines = [...untouched, ...rebuilt];
  renderOrderLines();
  const changedGroups = groups.filter((group) => group.hasChanges).length;
  showToast(`已按最大开合次数补足 ${changedGroups} 套模具的明细`);
  renderValidationResults();
}

function renderValidationResults() {
  const lines = readOrderLinesFromDom();
  const panel = $('#orderResult');
  if (lines.length === 0) {
    panel.className = 'result-panel empty';
    panel.innerHTML = '<p>请先新增订单明细。</p>';
    return { groups: [], errors: [] };
  }

  const { groups, errors, hasChanges } = calculateValidation(lines);
  if (!hasChanges) {
    panel.className = 'result-panel';
    panel.innerHTML = `
      <div class="result-title" style="color:var(--success)">
        <i data-lucide="badge-check"></i>
        <span>校验通过，各模具数量已按最大开合次数匹配。</span>
      </div>
    `;
    refreshIcons(panel);
    return { groups, errors };
  }

  const errorHtml = errors
    .map((item) => {
      return `
        <div class="result-item error">
          <div class="result-text">
            <strong>无法校验</strong>
            <p>${escapeHtml(item.text)}</p>
          </div>
        </div>
      `;
    })
    .join('');

  const groupHtml = groups
    .map((group) => {
      const driverText = group.drivers
        .map(
          (driver) =>
            `${escapeHtml(driver.materialNo)}（${escapeHtml(driver.quantity)} 个 / ${escapeHtml(driver.cavities)} 出）`,
        )
        .join('、');
      const itemHtml = group.items
        .map((item) => {
          const label = `${escapeHtml(item.materialNo)} ${escapeHtml(item.materialName || '')}（${escapeHtml(item.cavities)} 出）`;
          if (item.status === 'ok') {
            return `<div class="result-item ok"><div class="result-text"><strong>${label}</strong><p>数量正确：${escapeHtml(item.orderedQty)} 个</p><p class="result-reason">原因：${escapeHtml(item.reason)}</p></div></div>`;
          }
          if (item.status === 'missing') {
            return `<div class="result-item missing"><div class="result-text"><strong>${label}</strong><p>未下单，建议新增 ${escapeHtml(item.recommendedQty)} 个</p><p class="result-reason">原因：${escapeHtml(item.reason)}</p></div></div>`;
          }
          return `<div class="result-item warning"><div class="result-text"><strong>${label}</strong><p>原 ${escapeHtml(item.orderedQty)} 个，建议修改为 ${escapeHtml(item.recommendedQty)} 个</p><p class="result-reason">原因：${escapeHtml(item.reason)}</p></div></div>`;
        })
        .join('');
      return `
        <div class="result-group">
          <div class="result-group-head">
            <strong>${escapeHtml(group.supplier.name)} / 模具 ${escapeHtml(group.mold.moldNo)}</strong>
            <span>最大开合 ${escapeHtml(group.maxShots)} 次</span>
          </div>
          <p class="result-group-meta">由物料 ${driverText} 带动</p>
          <div class="result-list">${itemHtml}</div>
        </div>
      `;
    })
    .join('');

  const errorCount = errors.length;
  const adjustCount = groups.reduce(
    (total, group) => total + group.items.filter((item) => item.status === 'adjust').length,
    0,
  );
  const missingCount = groups.reduce(
    (total, group) => total + group.items.filter((item) => item.status === 'missing').length,
    0,
  );
  panel.className = 'result-panel';
  panel.innerHTML = `
    <div class="result-title" style="color:${errorCount > 0 ? 'var(--danger)' : 'var(--warning)'}">
      <i data-lucide="triangle-alert"></i>
      <span>发现错误 ${errorCount} 项，数量需调整 ${adjustCount} 项，缺料 ${missingCount} 项。</span>
    </div>
    ${errorHtml ? `<div class="result-list">${errorHtml}</div>` : ''}
    ${groupHtml}
  `;
  refreshIcons(panel);
  return { groups, errors };
}

function autoFillMissing() {
  applyValidationSuggestions();
}

async function saveCurrentOrder() {
  const orderNo = String($('#orderNoInput').value || '').trim();
  if (!orderNo) {
    showToast('请先填写订单号', 'error');
    $('#orderNoInput').focus();
    return;
  }
  const lines = readOrderLinesFromDom().map((line) => ({
    materialNo: line.materialNo,
    materialName: line.materialName,
    supplierId: line.supplierId,
    quantity: line.quantity,
    moldId: line.moldId,
    remark: line.remark,
  }));
  if (lines.length === 0) {
    showToast('请至少新增一条订单明细', 'error');
    return;
  }
  const invalid = lines.some(
    (line) =>
      !line.materialNo ||
      !line.supplierId ||
      !Number.isInteger(line.quantity) ||
      line.quantity <= 0,
  );
  if (invalid) {
    showToast('订单明细中有物料号、供应商或数量不完整', 'error');
    return;
  }

  const payload = {
    orderNo,
    status: '已校验',
    lines,
  };
  try {
    if (currentOrder.id) {
      await api(`api/orders/${encodeURIComponent(currentOrder.id)}`, {
        method: 'PUT',
        body: payload,
      });
      showToast('订单已更新');
    } else {
      await api('api/orders', {
        method: 'POST',
        body: payload,
      });
      showToast('订单已保存');
    }
    await loadState();
    renderOrders();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderOrders() {
  const body = $('#ordersTableBody');
  if (state.orders.length === 0) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">暂无订单记录</div></td></tr>`;
    return;
  }
  body.innerHTML = state.orders
    .map(
      (order) => `
        <tr>
          <td><strong>${escapeHtml(order.orderNo)}</strong></td>
          <td>${order.lines.length}</td>
          <td><span class="status-badge status-active">${escapeHtml(order.status || '已保存')}</span></td>
          <td>${escapeHtml(formatDate(order.updatedAt))}</td>
          <td class="actions-col">
            <div class="cell-actions">
              <button class="icon-button" data-load-order="${escapeAttr(order.id)}" aria-label="打开">
                <i data-lucide="folder-open"></i>
              </button>
              <button class="icon-button danger" data-delete-order="${escapeAttr(order.id)}" aria-label="删除">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `,
    )
    .join('');

  $$('[data-load-order]', body).forEach((button) => {
    button.addEventListener('click', () => {
      const order = state.orders.find((item) => item.id === button.dataset.loadOrder);
      if (!order) return;
      currentOrder = {
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        lines: order.lines.map((line) => ({ ...line })),
      };
      $('#orderNoInput').value = currentOrder.orderNo;
      renderOrderLines();
      switchView('order');
      showToast(`已打开订单 ${currentOrder.orderNo}`);
    });
  });

  $$('[data-delete-order]', body).forEach((button) => {
    button.addEventListener('click', async () => {
      const order = state.orders.find((item) => item.id === button.dataset.deleteOrder);
      if (!order) return;
      if (!window.confirm(`确认删除订单 ${order.orderNo} 吗？`)) return;
      await api(`api/orders/${encodeURIComponent(order.id)}`, { method: 'DELETE' });
      await loadState();
      renderOrders();
      showToast('订单已删除');
    });
  });
  refreshIcons(body);
}

async function queryMaterial() {
  const code = String($('#materialQueryInput').value || '').trim().toUpperCase();
  const nameKeyword = String($('#materialNameQueryInput').value || '').trim().toLowerCase();
  const panel = $('#materialResult');
  if (!code && !nameKeyword) {
    panel.className = 'result-panel empty';
    panel.innerHTML = '<p>请输入物料编码或物料名称关键词。</p>';
    return;
  }

  const results = [];
  for (const mold of state.molds) {
    for (const item of sortedMoldItems(mold)) {
      const codeMatch = !code || item.materialNo.toUpperCase().includes(code);
      const nameMatch =
        !nameKeyword ||
        String(item.materialName || '')
          .toLowerCase()
          .includes(nameKeyword);
      if (codeMatch && nameMatch) {
        const supplier = state.suppliers.find((entry) => entry.id === mold.supplierId);
        results.push({
          mold,
          item,
          supplierName: supplier?.name || '',
        });
      }
    }
  }

  if (results.length === 0) {
    panel.className = 'result-panel empty';
    panel.innerHTML = '<p>没有找到匹配的物料资料。</p>';
    return;
  }

  panel.className = 'result-panel';
  panel.innerHTML = `
    <div class="result-title">
      <i data-lucide="search"></i>
      <span>共匹配 ${results.length} 条物料资料</span>
    </div>
    <div class="result-list">
      ${results
        .map(
          ({ mold, item, supplierName }) => `
            <div class="result-item ok">
              <div class="result-text">
                <strong>${escapeHtml(item.materialNo)} ${highlightMaterialName(item.materialName || '-')}</strong>
                <p>模具 ${escapeHtml(mold.moldNo)} / 供应商 ${escapeHtml(supplierName || '-')} / 状态 ${escapeHtml(mold.status)} / 穴数 ${escapeHtml(item.cavities)} 出</p>
              </div>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
  refreshIcons(panel);
}

function parseImportRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error('导入文件至少需要表头和一条数据');
  }
  const header = rows[0].map((cell) => String(cell || '').trim());
  const indexOf = (...names) => {
    const normalized = header.map((item) => item.replace(/\s/g, '').toLowerCase());
    return normalized.findIndex((item) =>
      names.some((name) => item.includes(name.toLowerCase())),
    );
  };
  const moldIndex = indexOf('模具号', 'moldno');
  const supplierIndex = indexOf('供应商', 'supplier');
  const statusIndex = indexOf('模具状态', '状态', 'status');
  const materialIndex = indexOf('物料料号', '料号', 'materialno', '物料');
  const materialNameIndex = indexOf('物料名称', '名称', 'materialname');
  const cavitiesIndex = indexOf('穴数', '出数', 'cavities');
  if (moldIndex < 0 || supplierIndex < 0 || materialIndex < 0 || cavitiesIndex < 0) {
    throw new Error('表头缺少必要列：模具号、供应商、物料料号、穴数');
  }

  const grouped = new Map();
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const moldNo = String(row[moldIndex] || '').trim().toUpperCase();
    const supplier = String(row[supplierIndex] || '').trim();
    const materialNo = String(row[materialIndex] || '').trim().toUpperCase();
    const materialName = String(row[materialNameIndex] || '').trim();
    const cavities = Number(row[cavitiesIndex]);
    if (!moldNo || !supplier || !materialNo) continue;
    if (!Number.isInteger(cavities) || cavities <= 0) {
      throw new Error(`第 ${i + 1} 行穴数不是正整数`);
    }
    if (!grouped.has(moldNo)) {
      grouped.set(moldNo, {
        moldNo,
        supplierName: supplier,
        status: String(row[statusIndex] || '在用').trim() || '在用',
        remark: '',
        items: [],
      });
    }
    const group = grouped.get(moldNo);
    if (group.items.some((item) => item.materialNo === materialNo)) {
      throw new Error(`物料 ${materialNo} 在模具 ${moldNo} 中重复`);
    }
    group.items.push({ materialNo, materialName, cavities });
  }
  return Array.from(grouped.values());
}

async function importFile(file) {
  try {
    const rows = await readImportFile(file);
    const groups = parseImportRows(rows);
    if (groups.length === 0) {
      showToast('没有读取到有效数据', 'error');
      return;
    }
    const message = `共识别 ${groups.length} 套模具。是否导入？已存在的模具号会更新，不存在的会新增。`;
    if (!window.confirm(message)) return;
    let updated = 0;
    let created = 0;
    const supplierCache = new Map(
      state.suppliers.map((item) => [item.name.trim().toLowerCase(), item]),
    );
    for (const group of groups) {
      const supplierKey = group.supplierName.toLowerCase();
      let supplier = supplierCache.get(supplierKey);
      if (!supplier) {
        supplier = await api('api/suppliers', {
          method: 'POST',
          body: { name: group.supplierName },
        });
        supplierCache.set(supplierKey, supplier);
      }
      const existing = state.molds.find((mold) => mold.moldNo === group.moldNo);
      const items = group.items.map((item) => {
        const existingItem = existing?.items.find(
          (entry) => entry.materialNo === item.materialNo,
        );
        return {
          ...item,
          image: existingItem?.image || item.image || '',
        };
      });
      const payload = {
        moldNo: group.moldNo,
        supplierId: supplier.id,
        status: group.status,
        remark: group.remark,
        items,
      };
      if (existing) {
        await api(`api/molds/${encodeURIComponent(existing.id)}`, {
          method: 'PUT',
          body: payload,
        });
        updated += 1;
      } else {
        await api('api/molds', {
          method: 'POST',
          body: payload,
        });
        created += 1;
      }
    }
    await loadState();
    renderMolds();
    showToast(`导入完成：新增 ${created} 套，更新 ${updated} 套`);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function readImportFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await file.text();
    if (window.XLSX) {
      const workbook = window.XLSX.read(text, { type: 'string' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    }
    return parseCsv(text);
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    if (!window.XLSX) {
      throw new Error('Excel 解析组件未加载，请确认网络后重试，或将文件另存为 CSV');
    }
    const data = await file.arrayBuffer();
    const workbook = window.XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  }
  throw new Error('仅支持 .xlsx、.xls 或 .csv 文件');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function downloadTemplate() {
  const header = ['模具号', '供应商', '模具状态', '物料料号', '物料名称', '穴数'];
  const example = [
    ['A', '供应商甲', '在用', '001', '物料一', 1],
    ['A', '供应商甲', '在用', '002', '物料二', 2],
    ['A', '供应商甲', '在用', '003', '物料三', 4],
  ];
  const rows = [header, ...example];
  if (window.XLSX) {
    const sheet = window.XLSX.utils.aoa_to_sheet(rows);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, sheet, '模具资料');
    window.XLSX.writeFile(workbook, '模具信息导入模板.xlsx');
    return;
  }
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '模具信息导入模板.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function parseOrderImportRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error('导入文件至少需要表头和一条订单明细');
  }
  const header = rows[0].map((cell) => String(cell || '').trim());
  const indexOf = (...names) => {
    const normalized = header.map((item) => item.replace(/\s/g, '').toLowerCase());
    return normalized.findIndex((item) =>
      names.some((name) => item.includes(name.toLowerCase())),
    );
  };
  const materialIndex = indexOf('物料料号', '料号', 'materialno', '物料编码');
  const materialNameIndex = indexOf('物料名称', '名称', 'materialname');
  const quantityIndex = indexOf('数量', '订单数量', 'qty', 'quantity');
  const supplierIndex = indexOf('供应商', 'supplier');
  if (materialIndex < 0 || quantityIndex < 0 || supplierIndex < 0) {
    throw new Error('表头缺少必要列：物料料号、数量、供应商');
  }

  const lines = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const materialNo = String(row[materialIndex] || '').trim().toUpperCase();
    const materialName = String(row[materialNameIndex] || '').trim();
    const quantity = Number(row[quantityIndex]);
    const supplierName = String(row[supplierIndex] || '').trim();
    if (!materialNo) continue;
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`第 ${i + 1} 行数量必须是正整数`);
    }
    const allCandidates = moldsForMaterial(materialNo);
    let supplier = null;
    if (supplierName) {
      supplier = state.suppliers.find(
        (item) => item.name.trim().toLowerCase() === supplierName.toLowerCase(),
      );
      if (!supplier) {
        throw new Error(`第 ${i + 1} 行供应商“${supplierName}”未维护`);
      }
    } else {
      const uniqueSupplierIds = [...new Set(allCandidates.map((mold) => mold.supplierId))];
      if (uniqueSupplierIds.length === 1) {
        supplier = state.suppliers.find((item) => item.id === uniqueSupplierIds[0]) || null;
      } else if (uniqueSupplierIds.length > 1) {
        throw new Error(`第 ${i + 1} 行物料 ${materialNo} 有多家供应商，请填写供应商`);
      }
    }
    if (!supplier) {
      throw new Error(`第 ${i + 1} 行物料 ${materialNo} 未维护对应模具`);
    }
    const candidates = allCandidates.filter(
      (mold) => mold.supplierId === supplier.id,
    );
    if (candidates.length === 0) {
      throw new Error(`第 ${i + 1} 行物料 ${materialNo} 在供应商“${supplierName}”下没有对应模具`);
    }
    const moldId = candidates[0].id;
    lines.push({
      materialNo,
      materialName: materialName || materialNameForMaterial(materialNo, moldId),
      supplierId: supplier.id,
      quantity,
      moldId,
    });
  }
  return lines;
}

async function importOrderFile(file) {
  try {
    const rows = await readImportFile(file);
    const importedLines = parseOrderImportRows(rows);
    if (importedLines.length === 0) {
      showToast('没有读取到有效订单明细', 'error');
      return;
    }
    if (currentOrder.lines.length > 0) {
      const replace = window.confirm(
        '当前订单已有明细。点击“确定”清空后导入，点击“取消”追加到现有明细。',
      );
      if (replace) {
        currentOrder.lines = [];
      }
    }
    for (const line of importedLines) {
      currentOrder.lines.push({
        id: `line-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        materialNo: line.materialNo,
        materialName: line.materialName,
        supplierId: line.supplierId,
        quantity: line.quantity,
        moldId: line.moldId,
      });
    }
    renderOrderLines();
    showToast(`已导入 ${importedLines.length} 条订单明细`);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function downloadOrderTemplate() {
  const header = ['物料料号', '物料名称', '数量', '供应商'];
  const example = [
    ['001', '物料一', 100, '供应商甲'],
    ['002', '物料二', 200, '供应商甲'],
    ['003', '物料三', 400, '供应商甲'],
  ];
  const rows = [header, ...example];
  if (window.XLSX) {
    const sheet = window.XLSX.utils.aoa_to_sheet(rows);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, sheet, '订单明细');
    window.XLSX.writeFile(workbook, '订单明细导入模板.xlsx');
    return;
  }
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '订单明细导入模板.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function exportMolds() {
  const header = ['模具号', '供应商', '模具状态', '物料编码', '物料名称', '穴数', '备注'];
  const rows = [header];
  const sortedMolds = state.molds
    .map((mold) => ({
      mold,
      items: sortedMoldItems(mold),
      firstMaterialNo: sortedMoldItems(mold)[0]?.materialNo || '',
    }))
    .sort((a, b) => {
      const supplierCompare = supplierName(a.mold.supplierId).localeCompare(
        supplierName(b.mold.supplierId),
        'zh-CN',
      );
      if (supplierCompare !== 0) return supplierCompare;
      const materialCompare = a.firstMaterialNo.localeCompare(
        b.firstMaterialNo,
        'zh-CN',
      );
      if (materialCompare !== 0) return materialCompare;
      return a.mold.moldNo.localeCompare(b.mold.moldNo, 'zh-CN');
    });

  for (const { mold, items } of sortedMolds) {
    for (const item of items) {
      rows.push([
        mold.moldNo,
        supplierName(mold.supplierId),
        mold.status,
        item.materialNo,
        item.materialName,
        item.cavities,
        mold.remark,
      ]);
    }
  }

  if (window.XLSX) {
    const sheet = window.XLSX.utils.aoa_to_sheet(rows);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, sheet, '模具资料');
    window.XLSX.writeFile(workbook, '模具资料导出.xlsx');
    return;
  }

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '模具资料导出.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  $('#moldSearch').addEventListener('input', renderMolds);
  $('#moldStatusFilter').addEventListener('change', renderMolds);
  $('#btnNewMold').addEventListener('click', () => openMoldModal());
  $('#btnSuppliers').addEventListener('click', openSuppliersModal);
  $('#btnDownloadTemplate').addEventListener('click', downloadTemplate);
  $('#btnImport').addEventListener('click', () => $('#fileInput').click());
  $('#btnExportMolds').addEventListener('click', exportMolds);
  $('#fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) importFile(file);
    event.target.value = '';
  });
  $('#imageInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) uploadMoldImage(file);
    event.target.value = '';
    delete $('#imageInput').dataset.moldId;
    delete $('#imageInput').dataset.materialNo;
  });

  $('#btnAddOrderLine').addEventListener('click', () => addOrderLine());
  $('#btnValidateOrder').addEventListener('click', renderValidationResults);
  $('#btnAutoFill').addEventListener('click', autoFillMissing);
  $('#btnSaveOrder').addEventListener('click', saveCurrentOrder);
  $('#btnClearOrder').addEventListener('click', () => {
    resetOrder();
    showToast('已清除当前订单明细和校验结果');
  });
  $('#btnDownloadOrderTemplate').addEventListener('click', downloadOrderTemplate);
  $('#btnImportOrder').addEventListener('click', () => $('#orderFileInput').click());
  $('#orderFileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) importOrderFile(file);
    event.target.value = '';
  });

  $('#orderLineBody').addEventListener('change', (event) => {
    const row = event.target.closest('.order-line-row');
    if (!row) return;
    if (event.target.classList.contains('line-material')) {
      updateMoldSelectForRow(row);
    } else if (event.target.classList.contains('line-supplier')) {
      updateMoldSelectForRow(row);
    } else if (event.target.classList.contains('line-mold')) {
      currentOrder.lines[Number(row.dataset.index)].moldId = event.target.value;
    }
  });

  $('#orderLineBody').addEventListener('input', (event) => {
    const row = event.target.closest('.order-line-row');
    if (!row) return;
    const index = Number(row.dataset.index);
    const line = currentOrder.lines[index];
    if (!line) return;
    if (event.target.classList.contains('line-material')) {
      line.materialNo = String(event.target.value || '').trim().toUpperCase();
    } else if (event.target.classList.contains('line-material-name')) {
      line.materialName = event.target.value;
    } else if (event.target.classList.contains('line-supplier')) {
      line.supplierId = event.target.value;
    } else if (event.target.classList.contains('line-quantity')) {
      line.quantity = event.target.value;
    } else if (event.target.classList.contains('line-remark')) {
      line.remark = event.target.value;
    } else if (event.target.classList.contains('line-mold')) {
      line.moldId = event.target.value;
    }
  });

  $('#orderLineBody').addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-line]');
    if (!removeButton) return;
    const index = Number(removeButton.dataset.removeLine);
    currentOrder.lines.splice(index, 1);
    renderOrderLines();
  });

  $('#btnMaterialQuery').addEventListener('click', queryMaterial);
  $('#materialQueryInput').addEventListener('input', queryMaterial);
  $('#materialNameQueryInput').addEventListener('input', queryMaterial);
  $('#materialQueryInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') queryMaterial();
  });
  $('#materialNameQueryInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') queryMaterial();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
}

async function init() {
  try {
    await loadState();
    renderMolds();
    renderOrders();
    resetOrder();
    bindEvents();
    refreshIcons();
  } catch (error) {
    showToast(`系统加载失败：${error.message}`, 'error');
  }
}

init();
