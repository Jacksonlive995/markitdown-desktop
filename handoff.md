# Handoff - MarkItDown Desktop (v3.0)

## 1. 项目定位与技术栈
- **目标平台**：Windows + macOS 桌面端、iOS（iPhone/iPad）客户端 + 本地/远程双模式后端服务（支持本机 `127.0.0.1:8000` 自动拉起与远程 CPU VPS 部署）。
- **客户端**：Tauri 2 + React 19 + TypeScript + Vite（`manualChunks` 拆包 + `MarkdownEditor` 懒加载）+ **Tailwind CSS v4 + `@tailwindcss/typography` + shadcn/ui (Radix UI)** + **Zustand** + **CodeMirror 6** + **cmdk** + **Sonner** + `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-highlight`。
- **后端**：Python 3.12 + FastAPI + 线程池异步任务队列 + 内存元数据缓存 + SSE 实时进度推送 + 磁盘 JSON/MD/Assets 持久化（自动保存 `original.md` 与双引擎快照 `result_markitdown.md` / `result_docling.md`，启动自动恢复中断任务）。
- **解析引擎与 AI 视觉增强**：
  - `markitdown`：Word / Excel / PPT / HTML / CSV / JSON / URL 网页 / 剪贴板富文本极速转换，并自动提取 OpenXML 内嵌媒体与 Data URI 插图至 `assets/`。
  - `docling`：PDF / 扫描件 / 复杂表格 / 学术论文深度转换，支持页码范围、OCR 三档策略（`OcrAutoOptions(mode=OcrMode.FULL_PAGE/DEFAULT)` / 关闭 OCR）、按页实时进度回调与插图提取。
  - **OpenAI 兼容多模态 VLM**：支持在设置或环境变量中接入 GPT-4o / Qwen-VL / Ollama 等 OpenAI 兼容多模态模型，转换时自动解读全部插图，或在阅读器内对单张插图一键「AI 视觉解读」。

## 2. 目录结构
- `backend/app/main.py`：FastAPI v3.0 路由（健康检查、文件上传 `/api/convert`、URL 抓取转换 `/api/convert-url`、文本片段转换 `/api/convert-text`、全文检索 `/api/tasks?q=`、SSE 进度流 `/api/tasks/events`、任务取消 `/api/tasks/{id}/cancel`、静态插图资源 `/api/tasks/{id}/assets/{filename}`、单图 VLM 视觉解读 `/api/tasks/{id}/assets/{filename}/analyze`、VLM 连通测试 `/api/vlm/test`、Office 原件内联预览 `/api/tasks/{id}/source-preview`、Obsidian 知识库一键写入 `/api/tasks/{id}/export-to-vault`、ZIP 打包导出含 `assets/`、常量时间 Bearer Token 鉴权）。
- `backend/app/tasks.py`：`TaskManager`（内存索引缓存 `self._cache`、SSE 订阅广播、任务取消、实时进度更新、双引擎快照 `result_{engine}.md`、正文全文搜索与摘要提取、含 `assets/` 的 ZIP 打包与 Obsidian Vault 写入）。
- `backend/app/converter.py`：双引擎路由、Docling 2.x OCR 策略与按页进度回调、OpenXML & Docling 插图提取、`ConversionOptions` 与 YAML Frontmatter 注入。
- `backend/app/vlm.py`：基于 `httpx` 的 OpenAI 兼容多模态 VLM 客户端、MarkItDown `llm_client` 适配器与插图批量解读。
- `backend/app/source_preview.py`：`.xlsx`（多 Sheet 表格）、`.docx`（富文本结构 HTML）、`.pptx`（分页幻灯片 HTML）原件内联预览引擎。
- `backend/tests/test_api.py`：端到端 API 集成测试（12 项全覆盖测试）。
- `frontend/src/App.tsx`：主工作台（SSE 实时任务进度与桌面通知、按需懒加载 `MarkdownEditor`、全文搜索、单图 VLM 解读、顶栏「存入知识库」一键入库 Obsidian、iOS Share Sheet、Tauri 本机后端自动拉起）。
- `frontend/src/components/ConvertHub.tsx`：三标签页输入（文件与文件夹递归拖拽/导入、URL 网页/在线论文抓取、剪贴板/HTML 片段）与可展开「高级转换参数」面板。
- `frontend/src/components/MarkdownPreview.tsx`：YAML Frontmatter 元数据卡片、稳定锚点、自定义 `img`（自动解析 `assets/`、Lightbox 放大查看与单图「AI 视觉解读」）。
- `frontend/src/components/MarkdownEditor.tsx`：CodeMirror 6 编辑器、双栏「标题锚点 + 比例」双向同步滚动开关、修订对比支持「对比初始版本」与「双引擎 A/B 对比（MarkItDown vs Docling）」。
- `frontend/src/components/SourceViewer.tsx`：支持 PDF、图片缩放旋转、`.xlsx` 多 Sheet 表格、`.docx`/`.pptx` 富文本流、CSV/HTML/文本原件对照校对。
- `frontend/src/components/LibrarySidebar.tsx`：全文搜索正文命中摘要、实时进度条与阶段提示、任务一键取消、多选批量导出/删除。
- `frontend/src/components/SettingsModal.tsx`：三标签页设置弹窗（服务部署与节点 / OpenAI 兼容 VLM 视觉模型与连接测试 / Obsidian 知识库路径与目录预览）。
- `frontend/src/components/CommandPalette.tsx`：`⌘K / Ctrl+K` 全局命令面板（支持正文全文检索与一键存入知识库）。
- `frontend/src-tauri/src/lib.rs`：Tauri 2 Rust 壳，新增 `ensure_local_backend` 命令在本地模式下自动检测/拉起本机 uvicorn 服务。

## 3. 后端 API 速查（v3.0）
- `GET /api/health`：版本、双引擎状态、VLM 环境变量状态与特性清单。
- `POST /api/convert`：上传文件并支持 `page_range` / `ocr_mode` / `extract_images` / `use_vlm` / `frontmatter` / `vlm_config`。
- `POST /api/convert-url`：拉取远程网页或在线 PDF/Markdown 并转换。
- `POST /api/convert-text`：将剪贴板 HTML / CSV / JSON / TXT / MD 片段转为任务。
- `GET /api/tasks?q=关键词`：列表与「文件名 + Markdown 正文」全文搜索（返回 `match_snippet`）。
- `GET /api/tasks/events`：SSE 实时任务进度与状态事件流（支持 `Authorization` 或 `?token=`）。
- `POST /api/tasks/{id}/cancel` / `POST /api/tasks/{id}/retry`：取消或重试（可切换引擎与参数）。
- `GET /api/tasks/{id}/assets/{filename}` & `POST /api/tasks/{id}/assets/{filename}/analyze`：读取提取的插图及单图 VLM 视觉解读。
- `POST /api/vlm/test`：测试 OpenAI 兼容 VLM 端点连通性。
- `GET /api/tasks/{id}/source` & `GET /api/tasks/{id}/source-preview`：原件下载与 Office（`.xlsx`/`.docx`/`.pptx`）内联结构预览。
- `POST /api/tasks/{id}/export-to-vault`：一键将 `.md`（含 YAML Frontmatter 与重写后的图片路径）与 `assets/` 写入本地 Obsidian / 知识库目录。
- `GET /api/tasks/export-zip`：打包 `.md` 与 `assets/` 为 ZIP。

## 4. 本机运行与验证命令
```powershell
# 后端集成测试（12 项）
cd F:\Development\Gemini-Development\markitdown-desktop\backend
.\.venv\Scripts\python.exe -m pytest -v

# 启动后端
.\.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000

# 前端类型检查与 Vite 拆包构建
cd F:\Development\Gemini-Development\markitdown-desktop\frontend
npm run build

# Tauri Rust 检查与开发运行
cd F:\Development\Gemini-Development\markitdown-desktop\frontend\src-tauri
cargo check

# Windows MSI 安装包
cd F:\Development\Gemini-Development\markitdown-desktop\frontend
npm run tauri -- build --bundles msi
```

## 5. 当前交接状态（2026-11-27）
- **Windows 图标**：`frontend/src-tauri/tauri.conf.json` 已配置 PNG、ICO 与 ICNS 图标，引用的文件均位于 `frontend/src-tauri/icons/`。
- **MSI 与后端**：MSI 构建打包 Tauri 桌面端；当前没有把 Python 后端、`.venv` 或 Docling 模型缓存作为安装包资源。Tauri 本机启动逻辑会在应用附近查找 `backend/.venv`，因此独立安装包仍需另行提供后端运行环境。
- **最近一次 Windows 构建**：`npm run tauri -- build --bundles msi` 成功，x64 安装包位于 `frontend/src-tauri/target/release/bundle/msi/MarkItDown Desktop_3.0.0_x64_en-US.msi`（4.11 MiB）。
- **本机服务状态**：当前本机后端已按用户要求停止；再次运行可使用第 4 节的 Uvicorn 启动命令。
- **已知格式限制**：旧版 Word `.doc` 会在 MarkItDown 转换时因格式不受支持而失败；保存为 `.docx` 后再转换。
