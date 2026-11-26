# Handoff - MarkItDown Desktop

## 1. 项目定位与技术栈
- **目标平台**：Windows + macOS 桌面端、iOS（iPhone/iPad）客户端 + 本地/远程双模式后端服务（支持本机 `127.0.0.1:8000` 与远程 CPU VPS 部署）。
- **客户端**：Tauri 2 + React 19 + TypeScript + Vite + **Tailwind CSS v4 + `@tailwindcss/typography` + shadcn/ui (Radix UI)** + **Zustand** + **CodeMirror 6** + **cmdk** + **Sonner** + `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-highlight`。
- **后端**：Python 3.12 + FastAPI + 线程池异步任务队列 + 磁盘 JSON/MD 持久化（自动保存初始转换快照 `original.md` 供 Diff 对比与一键还原，启动时自动恢复中断任务）。
- **解析引擎**：
  - `markitdown`：Word / Excel / PPT / HTML / CSV / JSON / 剪贴板富文本片段等轻量极速转换。
  - `docling`：PDF / 扫描件 / 复杂表格 / 学术论文转换（纯文本模式：`image_placeholder=""`）。
  - `auto` 路由规则：PDF 与图片走 `docling`，其余走 `markitdown`。

## 2. 目录结构
- `backend/app/main.py`：FastAPI 路由（健康检查、文件上传转换 `/api/convert`、剪贴板/HTML/文本片段转换 `/api/convert-text`、任务查询、原文件内联预览、在线保存、重试、重命名/星标置顶 `PATCH /api/tasks/{id}`、批量删除 `/api/tasks/batch-delete`、单文件下载、ZIP 批量导出、常量时间 Bearer Token 鉴权）。
- `backend/app/tasks.py`：异步任务执行、启动中断恢复、`original.md` 原始版本保留、耗时统计与本地磁盘持久化（`backend/data/tasks/<task_id>/`）。
- `backend/app/converter.py`：双引擎路由与懒加载实例。
- `backend/tests/test_api.py`：端到端 API 集成测试（8 项全覆盖测试）。
- `frontend/src/App.tsx`：主工作台（Cupertino 毛玻璃顶栏、`阅读 / 编辑 / 校对` 三模式切换、合并导出菜单、状态栏、iOS 底部四栏导航、自动保存与全局快捷键）。
- `frontend/src/components/ConvertHub.tsx`：转换中心首页（三引擎卡片、批量拖拽上传、系统剪贴板/HTML富文本转换、一键载入学术论文示例、最近完成卡片网格）。
- `frontend/src/components/LibrarySidebar.tsx`：文档库侧边栏（按时间/星标分组、搜索、排序、五态筛选、多选批量导出/删除、内联重命名）。
- `frontend/src/components/MarkdownPreview.tsx`：基于 `rehypeStableHeadingIds` 的稳定锚点渲染、GFM + KaTeX + 代码语法高亮与一键复制代码、可调字体/字号/页宽。
- `frontend/src/components/MarkdownEditor.tsx`：CodeMirror 6 源码编辑器、格式化工具栏、排版精修下拉、`双栏同步 / 纯源码 / 修订对比 (Diff)` 三种子视图。
- `frontend/src/components/InspectorPanel.tsx`：右侧检查器（章节目录大纲、文档词数/阅读时长/元素统计与换引擎重转、阅读排版外观与 7 项 Markdown 智能清洗工具）。
- `frontend/src/components/SourceViewer.tsx`：原文件校对组件（PDF、图片缩放/旋转、CSV 表格/HTML/文本预览及原件下载）。
- `frontend/src/components/SettingsModal.tsx`：本机服务与远程服务器双模式切换、常用节点保存、带延迟测量的「测试连接」、草稿态保存。
- `frontend/src/components/CommandPalette.tsx`：`⌘K / Ctrl+K` 全局命令面板。
- `frontend/src/components/ui/`：shadcn/ui 基础组件库（`button`, `badge`, `dialog`, `dropdown-menu`, `tooltip`, `tabs`）。
- `frontend/src/stores/ui-store.ts`：Zustand 全局 UI 与持久化配置状态管理（支持本机/远程双模式与常用服务器节点列表）。
- `frontend/src/utils/markdown.ts`：目录大纲提取、全方位内容统计、7 项 Markdown 智能清洗算法、逐行 Diff 算法与学术论文示例模板。
- `frontend/src/index.css`：Tailwind CSS v4 + `@tailwindcss/typography` + Apple 原生精修版设计 Token 与深浅色代码高亮主题。
- `frontend/src-tauri/`：Tauri 2 Rust 壳配置（已配置 `dragDropEnabled: false` 兼容 WebView 文件拖拽）与全平台图标。

## 3. 后端 API 接口与快捷键速查
- **API 端点**：
  - `GET /api/health`：返回服务状态、版本号、双引擎可用性、是否开启鉴权与单文件大小上限（`MAX_UPLOAD_MB`，默认 200MB）。
  - `POST /api/convert`：流式分块上传并异步转换文件（校验扩展名白名单与大小上限）。
  - `POST /api/convert-text`：将剪贴板 HTML 富文本、CSV、JSON、XML、TXT 或 Markdown 片段直接创建为转换任务。
  - `GET /api/tasks` / `GET /api/tasks/{id}`：查询任务列表或详情（含 `markdown` 与初始快照 `original_markdown`）。
  - `PUT /api/tasks/{id}/markdown`：保存编辑后的 Markdown 并自动标记 `edited` 状态。
  - `PATCH /api/tasks/{id}`：重命名文档（`filename`）或切换星标置顶（`pinned`）。
  - `POST /api/tasks/{id}/retry`：使用原引擎或指定引擎（`markitdown` / `docling`）重新解析。
  - `GET /api/tasks/{id}/source` / `GET /api/tasks/{id}/download`：内联预览原文件或下载结果 `.md`。
  - `GET /api/tasks/export-zip` / `POST /api/tasks/batch-delete`：批量打包导出 ZIP 或批量删除。
- **桌面端快捷键**：
  - `Ctrl+K` / `⌘K`：打开全局命令面板
  - `Ctrl+S` / `⌘S`：立即保存当前 Markdown 修改
  - `Ctrl+B` / `⌘B`：折叠/展开左侧文档库侧边栏
  - `Ctrl+1` / `Ctrl+2` / `Ctrl+3`（macOS 为 `⌘1/2/3`）：在 **阅读 / 编辑 / 校对** 三种工作模式间快速切换

## 4. 本机环境与运行方式
- **Python 虚拟环境**：`backend/.venv`（已安装 `fastapi`、`markitdown[all]`、`docling`、`pytest` 等）。
- **Node.js**：已安装 `frontend/node_modules`（`npmmirror`）。
- **Rust / MSVC**：已安装 `rustc 1.100.0`、`cargo 1.100.0` 及 `Visual Studio 2022 BuildTools`。

启动本地开发：
```powershell
# 终端 1：启动后端
cd F:\Development\Gemini-Development\markitdown-desktop\backend
.\.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000

# 终端 2：启动 Tauri 桌面端
cd F:\Development\Gemini-Development\markitdown-desktop\frontend
npm run tauri dev
```

运行测试与检查：
```powershell
# 后端集成测试
cd F:\Development\Gemini-Development\markitdown-desktop\backend
.\.venv\Scripts\python.exe -m pytest -v

# 前端类型与构建检查
cd F:\Development\Gemini-Development\markitdown-desktop\frontend
npm run build
```

## 5. 已知注意项与待办
- **VPS 部署**：普通 CPU VPS 运行 `docling` 建议至少 4GB 内存（或设 `MAX_WORKERS=1`）；公网部署务必设置 `API_TOKEN`（支持环境变量 `API_TOKEN`、`DATA_DIR`、`MAX_WORKERS`、`MAX_UPLOAD_MB`、`CORS_ORIGINS`）。
- **打包发布**：
  - Windows 安装包：在 `frontend/` 执行 `npm run tauri build`。
  - macOS / iOS：需在 macOS + Xcode 环境执行 `npm run tauri build` 与 `npm run tauri ios init / build`。
- **后续可迭代方向**：PDF 提取图片静态资源回传预览、MinerU API 作为第三可选高精度引擎、Tauri Sidecar 内置本地 Python 引擎打包、批量拖拽文件夹。
