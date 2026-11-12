use std::process::Command;
use tauri::Manager;

fn spawn_server(app: &tauri::AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("Missing project directory")?;
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
        let home_bun = std::path::Path::new(&home).join(".bun/bin").join(if cfg!(windows) { "bun.exe" } else { "bun" });
        let bun = if home_bun.is_file() { home_bun.into_os_string() } else { "bun".into() };
        Command::new(bun)
            .arg(root.join("server/index.ts"))
            .current_dir(root)
            .spawn()
            .map_err(|err| format!("Failed to start development backend: {err}"))?;
    } else {
        let resources = app.path().resource_dir().map_err(|err| err.to_string())?;
        let data = app.path().app_data_dir().map_err(|err| err.to_string())?;
        std::fs::create_dir_all(&data).map_err(|err| err.to_string())?;
        let backend = resources.join("backend").join(if cfg!(windows) { "donate-server.exe" } else { "donate-server" });
        Command::new(backend)
            .current_dir(&data)
            .env("DONATE_CONFIG_FILE", data.join("config.yaml"))
            .env("DONATE_CONFIG_TEMPLATE", resources.join("config.example.yaml"))
            .spawn()
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
