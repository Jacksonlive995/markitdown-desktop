use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

fn is_local_backend_listening() -> bool {
    let addr: SocketAddr = "127.0.0.1:8000".parse().unwrap();
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

fn find_backend_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("backend"));
        if let Some(p) = cwd.parent() {
            candidates.push(p.join("backend"));
            if let Some(gp) = p.parent() {
                candidates.push(gp.join("backend"));
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("backend"));
            if let Some(p) = dir.parent() {
                candidates.push(p.join("backend"));
            }
        }
    }
    candidates.into_iter().find(|dir| dir.join("app").join("main.py").exists())
}

#[tauri::command]
fn ensure_local_backend() -> Result<String, String> {
    if is_local_backend_listening() {
        return Ok("already_running".to_string());
    }

    let backend_dir = find_backend_dir()
        .ok_or_else(|| "Local backend directory not found".to_string())?;

    let uvicorn_path = if cfg!(target_os = "windows") {
        backend_dir.join(".venv").join("Scripts").join("uvicorn.exe")
    } else {
        backend_dir.join(".venv").join("bin").join("uvicorn")
    };

    if !uvicorn_path.exists() {
        return Err(format!("uvicorn not found at {}", uvicorn_path.display()));
    }

    let mut cmd = Command::new(&uvicorn_path);
    cmd.args(["app.main:app", "--host", "127.0.0.1", "--port", "8000"])
        .current_dir(&backend_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to spawn local backend: {e}"))?;

    Ok("started".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ensure_local_backend])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
