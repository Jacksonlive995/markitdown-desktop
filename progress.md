# Progress Log - MarkItDown Desktop

## 2026-11-26 · 清理 Docling 图片占位符（纯文本模式）
- `backend/app/converter.py`：`export_to_markdown(image_placeholder="")` 并压缩多余空行。
- `frontend/src/components/MarkdownPreview.tsx`：预览渲染自动过滤历史文档中残留的 `<!-- image -->`。
- **验证状态**：`pytest` 4/4 通过，`frontend` `tsc && vite build` 通过。

## 2026-11-26 · v1.1 原文件对照校对功能上线
- **后端新增原文件预览接口**（`backend/app/tasks.py`、`backend/app/main.py`）：
  - 新增 `GET /api/tasks/{task_id}/source`，以 `inline` 方式返回原 PDF/图片二进制流，支持 Bearer Token 鉴权。
- **前端新增「原文对照」模式**（`frontend/src/components/SourceViewer.tsx`、`frontend/src/App.tsx`）：
  - 顶部工具栏新增「原文对照」开关，开启后自动收起左侧任务栏腾出宽阔视野。
  - 左侧内嵌原 PDF 预览或扫描图片（带放大/缩小缩放控件），中间支持鼠标拖动调节分栏比例，右侧可自由切换 `预览 / 双栏对照 / 源码` 修改并保存导出。

## 2026-11-26 · v1 UI 与核心工作流迭代完成
- **后端增强**（`backend/app/tasks.py`、`backend/app/main.py`）：
  - 新增文件大小（`file_size`）与解析耗时（`duration_ms`）统计。
  - 新增在线编辑保存接口 `PUT /api/tasks/{task_id}/markdown`。
  - 新增失败任务重试接口 `POST /api/tasks/{task_id}/retry`（支持切换解析引擎）。
  - 新增批量打包导出接口 `GET /api/tasks/export-zip`。
- **前端 v1 重构**（`frontend/src/`）：
  - 采用苹果原生风视觉（毛玻璃顶栏/侧边栏、浅色/深色/跟随系统三档主题）。
  - 实现可折叠侧边栏、`预览 / 双栏对照 / 源码` 三种视图、Markdown 在线微调编辑与持久化保存。
  - 实现自动目录大纲（TOC）提取与平滑跳转、词数/字符数统计、文件搜索与状态筛选、失败重试、ZIP 批量导出。
  - 适配移动端（iOS/iPad）底部三栏导航与安全区。
- **验证状态**：
  - `backend/.venv/Scripts/python.exe -m pytest -v`：4/4 通过。
  - `frontend`：`tsc && vite build` 通过。
  - `frontend/src-tauri`：`cargo check` 通过。

## 2026-11-26 · 本机 Windows 编译环境就绪
- 安装 Rust 1.100.0（`rustc` / `cargo`）并配置 `rsproxy-sparse` 国内镜像。
- 安装 Visual Studio 2022 C++ Build Tools（MSVC 链接器与 Windows SDK）。
- 生成全平台应用图标（Windows `.ico` / macOS `.icns` / iOS `AppIcon` / Android）。

## 2026-11-26 · MVP 初始化完成
- 搭建 FastAPI 异步任务后端，集成双引擎：`MarkItDown`（Office 文档）+ `Docling`（PDF / 扫描件 / 学术论文）。
- 搭建 Tauri 2 + React + TypeScript 客户端，集成 GFM 表格与 KaTeX 学术公式渲染。
- 提供 `backend/Dockerfile` 与 `.env.example` 供 VPS 部署。
