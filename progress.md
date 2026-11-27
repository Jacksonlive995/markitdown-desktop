# Progress Log - MarkItDown Desktop

## 2026-11-27 · 停止后端、更新交接和验证
- 按用户要求停止本地 Uvicorn 后端（PID 9568）；确认 `127.0.0.1:8000/api/health` 不再响应。
- 更新 `handoff.md`，补入 Windows MSI 构建命令、图标资源状态、后端未随 MSI 打包的限制、本地服务状态与旧 `.doc` 格式说明。
- 图标配置已存在于 `frontend/src-tauri/tauri.conf.json`；所引用的 5 个图标文件均存在。
- 验证：后端 pytest 12/12 通过（2 条第三方弃用警告）；前端 `npm run build` 通过；Tauri `cargo check` 通过；`npm run tauri -- build --bundles msi` 成功，x64 MSI 为 4.11 MiB。
- MSI 路径：`frontend/src-tauri/target/release/bundle/msi/MarkItDown Desktop_3.0.0_x64_en-US.msi`。该安装包当前未包含 Python 后端环境或 Docling 模型缓存。

## 2026-11-27 · 本机转换任务失败排查
- 查到最新失败任务：`天河理想城电梯维修费用支付说明.doc`，任务状态 `failed`、请求引擎 `markitdown`；任务异常为 MarkItDown 没有可用转换器处理此文件类型。
- 根因：这是旧版 `.doc` 格式；当前自动路由仅将 PDF 和图片优先交给 Docling，其余格式交给 MarkItDown，且 MarkItDown 不支持该 `.doc` 文件类型。保存为 `.docx` 后再转换可走现有 Office 路径。
- 日志现状：任务错误文本保存在任务元数据中；Tauri 启动后端时将 stdout/stderr 丢弃，因此没有单独的服务控制台堆栈日志。未修改代码。

## 2026-11-27 · 桌面端「新建转换」点击行为排查
- 根据用户截图及代码核对：侧栏按钮绑定 `App.tsx` 的 `handleOpenConvertHub`，仅清空文档选择并切换至转换工作台；已在工作台时再次点击没有可见变化。
- 选择文件入口位于 `ConvertHub.tsx` 的上传区域及「选择文件」按钮，点击后调用文件输入框；此次未修改交互行为，也未在桌面端执行点击验证。
- 当前状态：原因已定位；如需让「新建转换」直接打开文件选择框，属于后续交互调整。

## 2026-11-27 · v3.0 全面升级落地（P1 → P4 全部完成并通过验证）
- **P1 · 解析引擎增强、图文资源闭环与多模态 VLM 集成**：
  - 新增 `backend/app/vlm.py`，基于 `httpx` 实现零额外依赖的 OpenAI 兼容多模态 VLM 客户端与 `MarkItDown(llm_client=...)` 适配器；支持 `POST /api/vlm/test` 测试连通性与 `POST /api/tasks/{id}/assets/{filename}/analyze` 单图视觉解读。
  - 升级 `backend/app/converter.py`：Docling 2.x 改用 `OcrAutoOptions(mode=OcrMode.FULL_PAGE / DEFAULT)` / `do_ocr=False` 与 `page_range`；Docling 与 MarkItDown（OpenXML `word/media/*`、`ppt/media/*` 及 Data URI）提取插图至 `assets/fig_XX.*`；支持可选 YAML Frontmatter 元数据注入。
  - 新增 `GET /api/tasks/{id}/assets/{filename}` 静态资源服务与 `POST /api/convert-url` 网页/在线论文抓取转换；`export-zip` 自动打包 `.md` 与 `assets/`；导出独立 `.html` 自动将图片内嵌为 Base64。
  - 前端 `ConvertHub.tsx` 新增「URL 网页 / 在线论文」标签页与可展开「高级转换参数」面板；`MarkdownPreview.tsx` 自动解析 `assets/` 图片、支持 Lightbox 放大预览、YAML Frontmatter 元数据卡片与单图「AI 视觉解读」一键插入正文；`SettingsModal.tsx` 新增三标签页（服务与外观 / AI 视觉 VLM 含常用端点预设与连通测试 / Obsidian 知识库）。
- **P2 · Office 原件预览、双栏同步滚动、全文检索与双引擎 A/B 对比**：
  - 新增 `backend/app/source_preview.py` 与 `GET /api/tasks/{id}/source-preview`，支持 `.xlsx` 多 Sheet 表格与 `.docx`/`.pptx` 富文本结构流；`SourceViewer.tsx` 补齐 Office 原件左侧内联校对。
  - `MarkdownEditor.tsx` 实现双栏「标题锚点 + 区间比例」双向同步滚动与工具栏开关；新增「双引擎 A/B 对比（MarkItDown vs Docling）」视图与一键择优采用（后端自动保留 `result_markitdown.md` / `result_docling.md` 快照）。
  - 后端 `GET /api/tasks?q=` 支持同时检索文件名与 `result.md` 正文并返回 `match_snippet`，前端 `LibrarySidebar.tsx` 与 `CommandPalette.tsx` 实时展示正文命中摘要。
- **P3 · 实时进度流、任务取消、内存缓存与 Vite 拆包优化**：
  - `TaskManager` 新增内存索引缓存 `self._cache`、SSE 事件总线 `GET /api/tasks/events`、按页实时进度（`progress_pct` / `progress_stage`）与中途取消接口 `POST /api/tasks/{id}/cancel`。
  - `frontend/vite.config.ts` 配置 `manualChunks` 拆分 `codemirror` / `markdown-katex` / `radix-ui` / `lucide`，并对 `MarkdownEditor` 启用 `React.lazy` 按需懒加载，首屏主包由 **1.81 MB** 降至 **429 KB（gzip 127 KB）**，彻底消除大 Chunk 警告。
- **P4 · Tauri 2 原生集成与一键导出至 Obsidian / 本地知识库**：
  - 新增 `POST /api/tasks/{id}/export-to-vault` 与顶栏/导出菜单/命令面板「存入知识库 (Obsidian)」入口，一键写入 `.md`（自动补齐 YAML Frontmatter 并重写图片相对路径）与 `assets/<doc_stem>/` 全部插图。
  - `ConvertHub.tsx` 支持文件夹递归拖拽导入与「批量导入文件夹」按钮；`App.tsx` 集成后台任务完成桌面通知与 iOS/移动端 `navigator.share`；`frontend/src-tauri/src/lib.rs` 新增 `ensure_local_backend` 命令在本机模式下自动检测并拉起后端服务。
- **验证状态**：
  - `backend` `pytest -v`：**12/12 全部通过**（覆盖旧 8 项回归 + 插图提取/静态服务/ZIP打包/YAML Frontmatter/正文全文搜索/DOCX与XLSX原件预览/Obsidian Vault 写入/本地 HTTP URL 抓取/VLM 视觉解读/任务取消）。
  - `frontend` `npm run build`（`tsc && vite build`）：**零错误、零 Chunk 警告通过**。
  - `frontend/src-tauri` `cargo check`：**零错误、零警告通过**。

## 2026-11-27 · v3.0 升级方案确认与任务交接（已完成）
- **用户已确认 v3.0 全部实施范围**：
  1. **实施顺序**：按 `P1 → P2 → P3 → P4` 全部依次落地（详见 `handoff.md` 第 6 节）。
  2. **P1 · 引擎与图文闭环 + VLM 视觉模型**：
     - 提取 PDF / Word / PPT 内嵌图片至 `assets/` 并提供静态资源回传预览与打包导出；
     - 在设置中增加 **OpenAI 兼容多模态视觉模型（GPT-4o / Qwen-VL / DeepSeek 等）** 接口配置，用于对文档内复杂插图/流程图生成结构化说明；
     - 新增转换参数面板（PDF 页码范围、OCR 模式、图片开关、YAML Frontmatter 注入）与 **URL 网页/在线文档抓取转换**（`POST /api/convert-url`）。
  3. **P2 · 校对、同步滚动与全文检索**：
     - `.docx` / `.xlsx` 原件左侧内联预览（补齐 Office 校对闭环）；
     - CodeMirror 6 双栏编辑与右侧预览**双向同步滚动**；
     - 文档库支持 **文件名 + Markdown 正文全文搜索** 与命中摘要展示；
     - 双引擎（MarkItDown vs Docling）转换结果并排 A/B Diff 对比。
  4. **P3 · 实时进度、任务取消与性能优化**：
     - 任务阶段真实进度（`progress_pct` / `progress_stage`）、支持中途取消任务（`POST /api/tasks/{id}/cancel`）、后端内存索引缓存；
     - 前端 Vite `manualChunks` 拆包与编辑器懒加载（消除 1.81 MB 大 Chunk）。
  5. **P4 · 桌面原生化与 Obsidian 知识库联动**：
     - 新增 **「绑定 Obsidian / 本地知识库文件夹，一键将 `.md` 与 `assets/` 图片写入对应目录」** 功能；
     - 桌面端原生文件夹拖拽导入、本机后端自动检测与通知联动。
- **当前代码基线**：commit `8e77310`（v2.0 已全部构建并测试通过），新会话可直接从 **P1** 开始编码。

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
