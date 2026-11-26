# Progress Log - MarkItDown Desktop

## 2026-11-26 · v2.0 全面重构：Tailwind + shadcn/ui 苹果原生精修版与多模式工作台
- **界面技术栈升级**（`frontend/`）：
  - 全面迁移至 **Tailwind CSS v4 + `@tailwindcss/typography` + shadcn/ui (Radix UI 原语) + Zustand + Sonner + cmdk + CodeMirror 6 + rehype-highlight**。
  - 修复核心 Bug：
    1. 使用确定性 Rehype AST 插件 `rehypeStableHeadingIds` 生成标题锚点，彻底修复父组件重渲染导致的 TOC 目录跳转失效问题。
    2. `SettingsModal` 改为本地草稿态（Draft State）+ 显式「保存并应用」+「测试连接（带延迟毫秒与鉴权校验）」，彻底解决输入地址时每敲一个字就发请求的 Bug。
    3. 后端 `TaskManager` 启动时自动恢复中断的 `queued/processing` 任务，并加固扩展名白名单、流式分块上传大小限制与常量时间 Token 校验（`hmac.compare_digest`）。
    4. `tauri.conf.json` 设置 `dragDropEnabled: false`，确保桌面端 WebView 拖拽上传正常工作。
- **信息架构与视觉精修**：
  - **转换中心（ConvertHub）**：提供三引擎可视化卡片（智能双引擎路由 / MarkItDown 极速 / Docling 深度 OCR）、文件批量拖拽上传、**系统剪贴板/HTML富文本/CSV/JSON 片段直接转 Markdown**、以及**一键载入学术论文+公式+表格示例**。
  - **三模式工作区（阅读 / 编辑 / 校对）**：
    - **阅读模式**：去除卡片套卡片，采用精修版 Apple 阅读排版，代码块带语言标签与一键复制，支持无衬线/衬线字体、字号（14–18px）、版面宽度（紧凑/标准/宽屏）实时调节。
    - **编辑模式**：集成 **CodeMirror 6** 编辑器（行号、语法高亮、代码折叠、格式化工具栏），支持 **双栏同步 / 纯源码 / 修订对比（Diff 逐行对比初始转换结果）** 三种编辑子视图及防抖自动保存。
    - **校对模式**：左侧原文件预览（支持 PDF、图片缩放与旋转、HTML/CSV表格/文本预览及原件下载），右侧可随时在「渲染预览」与「源码微调」之间切换。
  - **右侧检查器（InspectorPanel）**：聚合「章节目录（带筛选与滚动高亮）」、「文档属性统计（词数/阅读时长/标题/表格/代码/公式计数、换引擎重转）」与「排版与 Markdown 智能清洗工具箱（一键智能精修、修复 PDF 跨行断句、压缩空行、规范标题、中英间距优化、GFM 表格列宽对齐）」。
  - **多格式导出与复制**：合并至顶栏「导出 ▾」菜单，支持导出 `.md`、独立样式 `.html`、`.txt`、打印/导出 `.pdf`、打包 `.zip`，以及复制 Markdown 源码、**复制为富文本（可直接粘贴到飞书/Notion/Word）**。
  - **双部署模式与 iOS 端适配**：设置支持「本机服务 (127.0.0.1:8000)」与「远程服务器 (VPS/局域网)」一键切换与常用节点保存；iOS/移动端配备底部四栏毛玻璃导航（转换中心/文档库/阅读器/设置）与底部抽屉式检查器。
- **验证状态**：
  - `backend/.venv/Scripts/python.exe -m pytest -v`：**8/8 通过**（含扩展名拦截、任务重命名与星标置顶、HTML 片段转换与批量删除、服务重启中断任务自动恢复、Word/Excel/PDF 双引擎端到端转换）。
  - `frontend`：`npm run build`（`tsc && vite build`）**零错误通过**。
  - **UI 实机预览验证**：已启动前后端服务并在浏览器预览完成「转换中心首页」、「三栏阅读与检查器模式」、「CodeMirror 6 双栏同步编辑模式」全流程交互与截图核验。

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
