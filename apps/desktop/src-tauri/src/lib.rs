use std::sync::atomic::{AtomicBool, Ordering};

/// Set at start-up when the window was left in full screen; cleared once re-entered.
static PENDING_FULLSCREEN: AtomicBool = AtomicBool::new(false);

/// Whether the window-state plugin's own file says the main window was full screen at the last quit.
#[cfg(desktop)]
fn left_in_fullscreen(app: &tauri::AppHandle) -> bool {
  use tauri::Manager;

  let Ok(dir) = app.path().app_config_dir() else { return false };
  let Ok(text) = std::fs::read_to_string(dir.join(tauri_plugin_window_state::DEFAULT_FILENAME)) else {
    return false;
  };
  serde_json::from_str::<serde_json::Value>(&text)
    .ok()
    .and_then(|state| state.get("main")?.get("fullscreen")?.as_bool())
    .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();
  // Restores the window as it was left: size, position, maximized, full screen (F13).
  // On the builder, not in `setup`: registered there it arrives after the window
  // is created, never tracks it, and saves an empty state.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
  // macOS ignores the plugin's full-screen restore: it runs before the window is on
  // screen, so the window only gets the screen's size. When it was left in full
  // screen, enter it again the first time the (now visible) window takes focus.
  #[cfg(desktop)]
  let builder = builder.on_window_event(|window, event| {
    if let tauri::WindowEvent::Focused(true) = event {
      if PENDING_FULLSCREEN.swap(false, Ordering::SeqCst) {
        let _ = window.set_fullscreen(true);
      }
    }
  });

  builder
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_http::init())
    // Opens the About page's links in the system browser, never in the app's own window (task 11.21).
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      #[cfg(desktop)]
      if left_in_fullscreen(app.handle()) {
        use tauri::Manager;

        PENDING_FULLSCREEN.store(true, Ordering::SeqCst);
        // Don't wait for a click: an app started from a background process (a
        // terminal, `tauri dev`) is not brought to the front by macOS, so the first
        // focus may never come. Bring the window forward and enter full screen, then
        // check: macOS ignores the request while the window is not on screen yet (a
        // slow launch), so a single attempt at a fixed delay could silently miss.
        // Each check waits out the ~1 s full-screen animation before asking again,
        // so a transition in progress is never toggled back. The focus hook stays
        // as the fallback.
        if let Some(window) = app.get_webview_window("main") {
          std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            for attempt in 1..=5 {
              if window.is_fullscreen().unwrap_or(false) {
                PENDING_FULLSCREEN.store(false, Ordering::SeqCst);
                log::info!("full screen restored after {} request(s)", attempt - 1);
                return;
              }
              let _ = window.set_focus();
              let _ = window.set_fullscreen(true);
              std::thread::sleep(std::time::Duration::from_millis(1500));
            }
            log::warn!("full screen not restored after 5 attempts");
          });
        }
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
