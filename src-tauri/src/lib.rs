use std::path::Path;
use std::process::Command;

fn spawn_server() {
    let home = std::env::var("HOME").unwrap_or_default();
    let bun_home_path = format!("{}/.bun/bin/bun", home);

    let (server_path, working_dir) = if Path::new("server.ts").exists() {
        ("server.ts", ".")
    } else if Path::new("../server.ts").exists() {
        ("../server.ts", "..")
    } else {
        ("server.ts", ".")
    };

    let try_spawn = |bin: &str| {
        Command::new(bin)
            .arg(server_path)
            .current_dir(working_dir)
            .spawn()
    };

    let _ = try_spawn(&bun_home_path)
        .or_else(|_| try_spawn("bun"))
        .or_else(|_| try_spawn("node"));
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
