#[cfg(any(windows, test))]
use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::Manager;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
    if cfg!(debug_assertions) {
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
            .map_err(|err| format!("Failed to start development backend: {err}"))?;
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
            .map_err(|err| format!("Failed to start bundled backend: {err}"))?;
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            spawn_server(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start_service])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
}
