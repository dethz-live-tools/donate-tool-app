use std::process::Command;

#[tauri::command]
fn start_service() -> Result<String, String> {
    let res = Command::new("bun")
        .arg("server.ts")
        .spawn()
        .map(|_| "Started with bun".to_string())
        .or_else(|_| {
            Command::new("node")
                .arg("server.ts")
                .spawn()
                .map(|_| "Started with node".to_string())
        });

    match res {
        Ok(msg) => Ok(msg),
        Err(e) => Err(format!("Failed to spawn server: {}", e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            let _ = Command::new("bun")
                .arg("server.ts")
                .spawn()
                .or_else(|_| Command::new("node").arg("server.ts").spawn());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start_service])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

