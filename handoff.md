# Handoff - MarkItDown Desktop

## 1. 项目定位与技术栈
- **目标平台**：Windows + macOS 桌面端、iOS（iPhone/iPad）客户端 + 自建后端服务（普通 CPU VPS 可部署）。
- **客户端**：Tauri 2 + React 18 + TypeScript + Vite（`react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `lucide-react`）。
- **后端**：Python 3.12 + FastAPI + 线程池异步任务队列 + 磁盘 JSON/MD 持久化。
- **解析引擎**：
  - `markitdown`：Word / Excel / PPT / HTML / CSV 等轻量极速转换。
  - `docling`：PDF / 扫描件 / 复杂表格 / 学术论文转换（纯文本模式：`image_placeholder=""`，不保留图片占位符）。
  - `auto` 路由规则：PDF 与图片走 `docling`，其余走 `markitdown`。

## 2. 目录结构
- `backend/app/main.py`：FastAPI 路由（健康检查、上传转换、任务查询、原文件内联预览、在线保存、重试、单文件下载、ZIP 批量导出、删除、Bearer Token 鉴权）。
- `backend/app/tasks.py`：异步任务执行、耗时统计与本地磁盘持久化（`backend/data/tasks/<task_id>/`）。
- `backend/app/converter.py`：双引擎路由与懒加载实例。
- `backend/tests/test_api.py`：端到端 API 集成测试。
- `backend/Dockerfile` & `backend/.env.example`：VPS 容器部署配置。
- `frontend/src/App.tsx`：主工作台（顶栏、可折叠侧边栏、任务筛选、三视图阅读器/编辑器、TOC、移动端底部导航）。
- `frontend/src/components/SourceViewer.tsx`：原 PDF 与扫描图片对照预览组件（Blob URL 鉴权加载 + 图片缩放）。
- `frontend/src/components/SettingsModal.tsx`：后端地址、Token、默认引擎、主题设置弹窗。
- `frontend/src/components/MarkdownPreview.tsx`：GFM + KaTeX 渲染、标题锚点生成与残留 `<!-- image -->` 过滤。
- `frontend/src/utils/markdown.ts`：目录大纲提取、字数统计、大小/耗时/相对时间格式化。
- `frontend/src-tauri/`：Tauri 2 Rust 壳配置与全平台图标。

## 3. 本机环境与运行方式
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

## 4. 已知注意项与待办
- **VPS 部署**：普通 CPU VPS 运行 `docling` 建议至少 4GB 内存（或设 `MAX_WORKERS=1`）；公网部署务必设置 `API_TOKEN`。
- **打包发布**：
  - Windows 安装包：在 `frontend/` 执行 `npm run tauri build`。
  - macOS / iOS：需在 macOS + Xcode 环境执行 `npm run tauri build` 与 `npm run tauri ios init / build`。
- **后续可迭代方向**：PDF 提取图片静态资源回传预览、MinerU API 作为第三可选高精度引擎、批量拖拽文件夹。
