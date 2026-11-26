# MarkItDown Desktop (Windows / macOS / iOS + 自建后端)

跨端文档转 Markdown 应用 MVP：
- **客户端**：Tauri 2 + React + TypeScript（支持 Windows、macOS、iOS 自适应布局，内置 GFM 表格与 KaTeX 学术公式渲染）。
- **后端**：FastAPI + 异步任务队列 + 双引擎（`MarkItDown` 处理 Office 文档，`Docling` 处理 PDF / 扫描件 / 学术论文）。

## 1. 启动后端（本地或 VPS）

```powershell
cd backend
.\.venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8000
```

如需在公网 VPS 部署，建议设置鉴权 Token 并用 Docker 运行：

```bash
cd backend
docker build -t markitdown-api .
docker run -d -p 8000:8000 -e API_TOKEN=your-secret-token -v $(pwd)/data:/app/data markitdown-api
```

## 2. 启动前端（浏览器调试或 Tauri 打包）

浏览器直接运行（无需 Rust）：

```powershell
cd frontend
npm install
npm run dev
```

安装 Rust 工具链后，打包桌面端 / iOS：

```bash
# Windows / macOS 桌面端
npm run tauri dev
npm run tauri build

# iOS（需在 macOS + Xcode 环境执行）
npm run tauri ios init
npm run tauri ios dev
```

## 3. 运行后端测试

```powershell
cd backend
.\.venv\Scripts\pytest.exe -v
```
