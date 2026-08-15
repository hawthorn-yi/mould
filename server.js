const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const defaultData = {
  suppliers: [
    {
      id: 'sup-1',
      name: '供应商甲',
      contact: '',
      phone: '',
      remark: '',
    },
    {
      id: 'sup-2',
      name: '供应商乙',
      contact: '',
      phone: '',
      remark: '',
    },
  ],
  molds: [
    {
      id: 'mold-A',
      moldNo: 'A',
      supplierId: 'sup-1',
      status: '在用',
      remark: '示例模具',
      items: [
        { id: 'item-A-001', materialNo: '001', materialName: '物料一', cavities: 1 },
        { id: 'item-A-002', materialNo: '002', materialName: '物料二', cavities: 2 },
        { id: 'item-A-003', materialNo: '003', materialName: '物料三', cavities: 4 },
      ],
    },
    {
      id: 'mold-B',
      moldNo: 'B',
      supplierId: 'sup-2',
      status: '在用',
      remark: '示例模具',
      items: [
        { id: 'item-B-001', materialNo: '001', materialName: '物料一', cavities: 2 },
        { id: 'item-B-004', materialNo: '004', materialName: '物料四', cavities: 4 },
        { id: 'item-B-005', materialNo: '005', materialName: '物料五', cavities: 1 },
      ],
    },
  ],
  orders: [],
};

async function ensureData() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.promises.access(DATA_FILE);
  } catch {
    await fs.promises.writeFile(DATA_FILE, JSON.stringify(defaultData, null, 2), 'utf8');
  }
}

async function readData() {
  await ensureData();
  const raw = await fs.promises.readFile(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(JSON.stringify(defaultData));
  }
}

async function writeData(data) {
  await ensureData();
  await fs.promises.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('数据过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeMold(input, existing = {}) {
  const moldNo = normalizeText(input.moldNo).toUpperCase();
  const supplierId = normalizeText(input.supplierId);
  const status = normalizeText(input.status) || '在用';
  const remark = normalizeText(input.remark);
  const rawItems = Array.isArray(input.items) ? input.items : [];
  const items = [];
  const seen = new Set();

  for (const item of rawItems) {
    const materialNo = normalizeText(item.materialNo).toUpperCase();
    const materialName = normalizeText(item.materialName);
    const cavities = Number(item.cavities);
    if (!materialNo) {
      continue;
    }
    if (seen.has(materialNo)) {
      throw new Error(`物料 ${materialNo} 在同一模具中重复`);
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

function normalizeSupplier(input, existing = {}) {
  const name = normalizeText(input.name);
  if (!name) {
    throw new Error('供应商名称不能为空');
  }
  return {
    id: existing.id || `sup-${crypto.randomUUID()}`,
    name,
    contact: normalizeText(input.contact),
    phone: normalizeText(input.phone),
    remark: normalizeText(input.remark),
  };
}

function normalizeOrder(input, existing = {}) {
  const orderNo = normalizeText(input.orderNo);
  if (!orderNo) {
    throw new Error('订单号不能为空');
  }
  const lines = Array.isArray(input.lines) ? input.lines : [];
  const normalizedLines = [];
  for (const line of lines) {
    const materialNo = normalizeText(line.materialNo).toUpperCase();
    const quantity = Number(line.quantity);
    if (!materialNo) {
      throw new Error('订单中存在空物料号');
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`物料 ${materialNo} 的数量必须是正整数`);
    }
    normalizedLines.push({
      id: line.id || `line-${crypto.randomUUID()}`,
      materialNo,
      materialName: normalizeText(line.materialName),
      supplierId: normalizeText(line.supplierId),
      quantity,
      moldId: normalizeText(line.moldId),
      remark: normalizeText(line.remark),
    });
  }
  return {
    id: existing.id || `order-${crypto.randomUUID()}`,
    orderNo,
    lines: normalizedLines,
    status: normalizeText(input.status) || '草稿',
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function getPathSegments(url) {
  const pathname = decodeURIComponent(url.pathname);
  return pathname.split('/').filter(Boolean);
}

async function handleApi(req, res, url) {
  const method = req.method;
  const fullSegments = getPathSegments(url);
  const segments = fullSegments[0] === 'api' ? fullSegments.slice(1) : fullSegments;
  const root = segments[0];

  if (method === 'GET' && root === 'state') {
    return sendJson(res, 200, await readData());
  }

  if (method === 'PUT' && root === 'state') {
    const body = await readBody(req);
    await writeData(body);
    return sendJson(res, 200, body);
  }

  if (root === 'suppliers') {
    if (method === 'GET' && segments.length === 1) {
      const data = await readData();
      return sendJson(res, 200, data.suppliers || []);
    }
    if (method === 'POST' && segments.length === 1) {
      const body = await readBody(req);
      const data = await readData();
      const supplier = normalizeSupplier(body);
      data.suppliers.push(supplier);
      await writeData(data);
      return sendJson(res, 201, supplier);
    }
    if (segments.length === 2) {
      const id = segments[1];
      const data = await readData();
      const index = data.suppliers.findIndex((item) => item.id === id);
      if (index === -1) return sendError(res, 404, '供应商不存在');
      if (method === 'PUT') {
        const body = await readBody(req);
        data.suppliers[index] = normalizeSupplier(body, data.suppliers[index]);
        await writeData(data);
        return sendJson(res, 200, data.suppliers[index]);
      }
      if (method === 'DELETE') {
        const used = data.molds.some((mold) => mold.supplierId === id);
        if (used) return sendError(res, 400, '该供应商已被模具使用，不能删除');
        data.suppliers.splice(index, 1);
        await writeData(data);
        return sendJson(res, 204, {});
      }
    }
  }

  if (root === 'molds') {
    if (method === 'GET' && segments.length === 1) {
      const data = await readData();
      return sendJson(res, 200, data.molds || []);
    }
    if (method === 'POST' && segments.length === 1) {
      const body = await readBody(req);
      const data = await readData();
      const mold = normalizeMold(body);
      if (data.molds.some((item) => item.moldNo === mold.moldNo)) {
        return sendError(res, 400, `模具号 ${mold.moldNo} 已存在`);
      }
      data.molds.push(mold);
      await writeData(data);
      return sendJson(res, 201, mold);
    }
    if (segments.length === 2) {
      const id = segments[1];
      const data = await readData();
      const index = data.molds.findIndex((item) => item.id === id);
      if (index === -1) return sendError(res, 404, '模具不存在');
      if (method === 'PUT') {
        const body = await readBody(req);
        const mold = normalizeMold(body, data.molds[index]);
        const duplicate = data.molds.some((item) => item.moldNo === mold.moldNo && item.id !== mold.id);
        if (duplicate) return sendError(res, 400, `模具号 ${mold.moldNo} 已存在`);
        data.molds[index] = mold;
        await writeData(data);
        return sendJson(res, 200, mold);
      }
      if (method === 'DELETE') {
        data.molds.splice(index, 1);
        await writeData(data);
        return sendJson(res, 204, {});
      }
    }
  }

  if (root === 'materials' && method === 'GET' && segments.length === 2) {
    const materialNo = normalizeText(segments[1]).toUpperCase();
    const data = await readData();
    const supplierMap = new Map((data.suppliers || []).map((item) => [item.id, item]));
    const result = (data.molds || [])
      .map((mold) => {
        const item = mold.items.find((line) => line.materialNo === materialNo);
        if (!item) return null;
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
    return sendJson(res, 200, result);
  }

  if (root === 'orders') {
    if (method === 'GET' && segments.length === 1) {
      const data = await readData();
      return sendJson(res, 200, data.orders || []);
    }
    if (method === 'POST' && segments.length === 1) {
      const body = await readBody(req);
      const data = await readData();
      const order = normalizeOrder(body);
      if (data.orders.some((item) => item.orderNo === order.orderNo)) {
        return sendError(res, 400, `订单号 ${order.orderNo} 已存在`);
      }
      data.orders.unshift(order);
      await writeData(data);
      return sendJson(res, 201, order);
    }
    if (segments.length === 2) {
      const id = segments[1];
      const data = await readData();
      const index = data.orders.findIndex((item) => item.id === id);
      if (index === -1) return sendError(res, 404, '订单不存在');
      if (method === 'PUT') {
        const body = await readBody(req);
        const order = normalizeOrder(body, data.orders[index]);
        const duplicate = data.orders.some((item) => item.orderNo === order.orderNo && item.id !== order.id);
        if (duplicate) return sendError(res, 400, `订单号 ${order.orderNo} 已存在`);
        data.orders[index] = order;
        await writeData(data);
        return sendJson(res, 200, order);
      }
      if (method === 'DELETE') {
        data.orders.splice(index, 1);
        await writeData(data);
        return sendJson(res, 204, {});
      }
    }
  }

  return sendError(res, 404, '接口不存在');
}

function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, relativePath);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    return sendError(res, 403, '禁止访问');
  }

  fs.readFile(resolved, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return sendError(res, 404, '文件不存在');
      }
      return sendError(res, 500, '读取文件失败');
    }
    const ext = path.extname(resolved).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon',
    };
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
}

async function main() {
  await ensureData();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else {
        serveStatic(req, res, url);
      }
    } catch (error) {
      if (!res.headersSent) {
        sendError(res, 400, error.message || '请求处理失败');
      } else {
        res.end();
      }
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`模具管理系统已启动：http://${HOST}:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
