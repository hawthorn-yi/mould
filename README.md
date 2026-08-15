# 模具管理系统

一个面向制造企业采购员的简易模具信息和采购订单配套校验工具。

## 启动方式

```powershell
node server.js
```

浏览器打开 `http://127.0.0.1:3000`。

## 数据文件

- 数据保存在 `data/db.json`。
- 建议定期备份 `data` 目录。
- 首次启动会生成 A/B 两套示例模具，可在页面中删除或替换。

## 使用 Supabase

配置环境变量：

```powershell
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_ANON_KEY = "your-anon-key"
$env:PORT = "3000"
$env:HOST = "0.0.0.0"
```

首次使用先在 Supabase 后台的 SQL Editor 执行 `supabase/migrations/20260815_init.sql`，然后导入本地数据：

```powershell
node scripts/sync-to-supabase.js
```

启动服务后，网站会自动使用 Supabase 数据库；不配置 Supabase 环境变量时，仍使用本地 `data/db.json`。

## 主要功能

- 模具资料维护：新增、编辑、删除、Excel/CSV 导入，支持物料名称。
- 物料查询：输入料号查看所有可生产模具及供应商。
- 采购订单校验：手动录入或 Excel 导入订单明细，按模具穴数比例提示缺配套或数量不匹配。
- 订单保存与历史记录。
