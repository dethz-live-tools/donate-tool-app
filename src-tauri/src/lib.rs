use std::process::Command;

fn spawn_server() {
    let home = std::env::var("HOME").unwrap_or_default();
    let bun_home_path = format!("{}/.bun/bin/bun", home);

    let _ = Command::new(&bun_home_path)
        .arg("server.ts")
        .spawn()
        .or_else(|_| Command::new("bun").arg("server.ts").spawn())
        .or_else(|_| Command::new("node").arg("server.ts").spawn());
}

#[tauri::command]
fn start_service() -> Result<String, String> {
    spawn_server();
    Ok("Backend service spawn triggered".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            spawn_server();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start_service])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
