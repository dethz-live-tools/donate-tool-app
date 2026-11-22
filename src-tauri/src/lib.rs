#[cfg(any(windows, test))]
use std::ffi::OsString;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::Manager;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const BACKEND_PORT: u16 = 3001;
const EXPECTED_SCREEN_SHARE_REVISION: &str = "\"apiRevision\":5";

struct BackendProcess(Mutex<Option<Child>>);

fn parse_http_status_code(response: &str) -> Option<u16> {
    let first_line = response.lines().next()?;
    let code = first_line.split_whitespace().nth(1)?;
    code.parse::<u16>().ok()
}

fn is_current_screen_share_response(status: u16, body: &str) -> bool {
    status == 200 && body.contains(EXPECTED_SCREEN_SHARE_REVISION)
}

fn is_known_backend_process(comm: &str) -> bool {
    let trimmed = comm.trim().trim_matches('"');
    let name = Path::new(trimmed)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(trimmed)
        .to_ascii_lowercase();
    matches!(
        name.as_str(),
        "donate-server" | "donate-server.exe" | "bun" | "bun.exe" | "node" | "node.exe"
    )
}

fn http_get_response(port: u16, path: &str) -> Option<(u16, String)> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(300)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(req.as_bytes()).ok()?;
    let mut buf = Vec::with_capacity(1024);
    let _ = stream.take(4096).read_to_end(&mut buf);
    let raw = String::from_utf8_lossy(&buf).into_owned();
    let status = parse_http_status_code(&raw)?;
    Some((status, raw))
}

fn is_backend_current(port: u16) -> bool {
    match http_get_response(port, "/api/screen-share/status") {
        Some((status, body)) => is_current_screen_share_response(status, &body),
        None => false,
    }
}

fn stop_outdated_backend_on_port(port: u16) {
    let status_ok = matches!(http_get_response(port, "/api/status"), Some((200, _)));
    if !status_ok || is_backend_current(port) {
        return;
    }

    #[cfg(unix)]
    {
        if let Ok(output) = Command::new("lsof")
            .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
            .output()
        {
            let self_pid = std::process::id();
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let Ok(pid) = line.trim().parse::<u32>() else { continue };
                if pid == 0 || pid == self_pid {
                    continue;
                }
                if let Ok(ps_out) = Command::new("ps")
                    .args(["-o", "comm=", "-p", &pid.to_string()])
                    .output()
                {
                    let comm = String::from_utf8_lossy(&ps_out.stdout);
                    if is_known_backend_process(&comm) {
                        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    {
        let mut netstat = Command::new("netstat");
        netstat.args(["-ano", "-p", "tcp"]).creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = netstat.output() {
            let suffix = format!(":{port}");
            let self_pid = std::process::id();
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 5 || parts[3] != "LISTENING" || !parts[1].ends_with(&suffix) {
                    continue;
                }
                let Ok(pid) = parts[4].parse::<u32>() else { continue };
                if pid == 0 || pid == self_pid {
                    continue;
                }
                let mut tasklist = Command::new("tasklist");
                tasklist
                    .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
                    .creation_flags(CREATE_NO_WINDOW);
                if let Ok(tl_out) = tasklist.output() {
                    let line = String::from_utf8_lossy(&tl_out.stdout);
                    let image = line.split(',').next().unwrap_or("");
                    if is_known_backend_process(image) {
                        let mut kill = Command::new("taskkill");
                        kill.args(["/PID", &pid.to_string(), "/T", "/F"])
                            .creation_flags(CREATE_NO_WINDOW);
                        let _ = kill.status();
                    }
                }
            }
        }
    }

    let deadline = Instant::now() + Duration::from_millis(2000);
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_err() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn stop_managed_server(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<BackendProcess>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[cfg(any(windows, test))]
fn windows_config_dir(appdata: Option<OsString>, roaming_data_dir: Option<PathBuf>) -> Result<PathBuf, String> {
    let base = appdata
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or(roaming_data_dir)
        .ok_or_else(|| "Missing Windows APPDATA directory".to_string())?;
    Ok(base.join("dethz-lab").join("dethz-socket"))
}

fn resolve_config_dir(app: &tauri::AppHandle, app_data_dir: &Path) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let _ = app_data_dir;
        windows_config_dir(std::env::var_os("APPDATA"), app.path().data_dir().ok())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(app_data_dir.to_path_buf())
    }
}

fn migrate_legacy_config(legacy_dir: &Path, config_dir: &Path) -> Result<(), String> {
    let legacy_config = legacy_dir.join("config.yaml");
    let target_config = config_dir.join("config.yaml");
    if legacy_config == target_config
        || target_config.exists()
        || config_dir.join("connector-config.json").exists()
        || !legacy_config.is_file()
    {
        return Ok(());
    }
    let bytes = std::fs::read(&legacy_config).map_err(|err| err.to_string())?;
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target_config)
    {
        Ok(mut file) => {
            if let Err(err) = file.write_all(&bytes) {
                let _ = std::fs::remove_file(&target_config);
                return Err(err.to_string());
            }
            Ok(())
        }
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

fn spawn_server(app: &tauri::AppHandle) -> Result<(), String> {
    stop_managed_server(app);
    stop_outdated_backend_on_port(BACKEND_PORT);

    // If an up-to-date backend is already serving (e.g. started by `bun run dev`), reuse it
    if is_backend_current(BACKEND_PORT) {
        return Ok(());
    }

    let child = if cfg!(debug_assertions) {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("Missing project directory")?;
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
        let home_bun = std::path::Path::new(&home).join(".bun/bin").join(if cfg!(windows) { "bun.exe" } else { "bun" });
        let bun = if home_bun.is_file() { home_bun.into_os_string() } else { "bun".into() };
        let mut cmd = Command::new(bun);
        cmd.arg(root.join("server/index.ts")).current_dir(root);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.spawn()
            .map_err(|err| format!("Failed to start development backend: {err}"))?
    } else {
        let resources = app.path().resource_dir().map_err(|err| err.to_string())?;
        let data = app.path().app_data_dir().map_err(|err| err.to_string())?;
        std::fs::create_dir_all(&data).map_err(|err| err.to_string())?;
        let config_dir = resolve_config_dir(app, &data)?;
        std::fs::create_dir_all(&config_dir).map_err(|err| err.to_string())?;
        migrate_legacy_config(&data, &config_dir)?;
        let backend = resources.join("backend").join(if cfg!(windows) { "donate-server.exe" } else { "donate-server" });
        let mut cmd = Command::new(backend);
        cmd.current_dir(&data)
            .env("DONATE_CONFIG_FILE", config_dir.join("config.yaml"))
            .env("DONATE_CONFIG_TEMPLATE", resources.join("config.example.yaml"));
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.spawn()
            .map_err(|err| format!("Failed to start bundled backend: {err}"))?
    };

    if let Some(state) = app.try_state::<BackendProcess>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = Some(child);
        }
    }
    Ok(())
}

#[tauri::command]
fn start_service(app: tauri::AppHandle) -> Result<String, String> {
    spawn_server(&app)?;
    Ok("Backend service spawn triggered".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            spawn_server(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start_service])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            stop_managed_server(app_handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("donate-socket-{name}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolves_windows_config_dir_under_appdata() {
        let dir = windows_config_dir(
            Some(OsString::from("C:\\Users\\tester\\AppData\\Roaming")),
            Some(PathBuf::from("C:\\Fallback")),
        )
        .unwrap();
        assert_eq!(
            dir,
            PathBuf::from("C:\\Users\\tester\\AppData\\Roaming")
                .join("dethz-lab")
                .join("dethz-socket")
        );
    }

    #[test]
    fn windows_config_dir_falls_back_when_appdata_empty_or_missing() {
        let dir = windows_config_dir(
            Some(OsString::from("")),
            Some(PathBuf::from("/fallback/roaming")),
        )
        .unwrap();
        assert_eq!(dir, PathBuf::from("/fallback/roaming").join("dethz-lab").join("dethz-socket"));
        assert!(windows_config_dir(None, None).is_err());
    }

    #[test]
    fn migrates_legacy_config_once_without_overwriting_target() {
        let root = unique_temp_dir("migrate");
        let legacy = root.join("zip.kizuna.donate");
        let target = root.join("dethz-lab").join("dethz-socket");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(legacy.join("config.yaml"), "tiktok:\n  username: legacy\n").unwrap();

        migrate_legacy_config(&legacy, &target).unwrap();
        assert_eq!(
            std::fs::read_to_string(target.join("config.yaml")).unwrap(),
            "tiktok:\n  username: legacy\n"
        );

        std::fs::write(target.join("config.yaml"), "tiktok:\n  username: updated\n").unwrap();
        migrate_legacy_config(&legacy, &target).unwrap();
        assert_eq!(
            std::fs::read_to_string(target.join("config.yaml")).unwrap(),
            "tiktok:\n  username: updated\n"
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn parses_http_status_codes_and_identifies_known_backends() {
        assert_eq!(parse_http_status_code("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"), Some(200));
        assert_eq!(parse_http_status_code("HTTP/1.1 404 Not Found\r\n"), Some(404));
        assert_eq!(parse_http_status_code("garbage"), None);
        assert!(is_current_screen_share_response(200, r#"{"success":true,"status":{"apiRevision":5,"running":false}}"#));
        assert!(!is_current_screen_share_response(200, r#"{"success":true,"status":{"running":false}}"#));
        assert!(!is_current_screen_share_response(404, "Not Found"));

        assert!(is_known_backend_process("/Applications/donate-socket.app/Contents/Resources/backend/donate-server"));
        assert!(is_known_backend_process("\"donate-server.exe\""));
        assert!(is_known_backend_process("/Users/dev/.bun/bin/bun"));
        assert!(is_known_backend_process("node.exe"));
        assert!(!is_known_backend_process("/usr/sbin/httpd"));
        assert!(!is_known_backend_process("postgres"));
    }
}
