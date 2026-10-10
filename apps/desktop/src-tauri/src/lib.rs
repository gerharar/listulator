use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

mod fullscreen;
mod isolation_csp;
mod navigation;

/// Set at start-up when the window was left in full screen; cleared once re-entered.
static PENDING_FULLSCREEN: AtomicBool = AtomicBool::new(false);

/// Which full-screen changes get recorded (`fullscreen.rs`). Set up in `setup`.
static TRACKER: Mutex<Option<fullscreen::Tracker>> = Mutex::new(None);

fn with_tracker<T>(action: impl FnOnce(&mut fullscreen::Tracker) -> T) -> Option<T> {
  TRACKER.lock().ok()?.as_mut().map(action)
}

#[cfg(desktop)]
fn config_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
  use tauri::Manager;

  app.path().app_config_dir().ok()
}

/// Restarts the app after an update was installed (macOS: Windows restarts through its installer). Goes through the exit events
/// (`request_restart`), not `restart()`: on the main thread `restart()` skips them, and the window's size and the full-screen
/// state are saved on them. Takes nothing from the page: the only parameter is the app handle Tauri supplies. Not run by a test
/// (it replaces the process); `tauriCapabilities.guard.test.ts` reads this source, and a built app is the proof.
#[tauri::command]
fn relaunch(app: tauri::AppHandle) {
  app.request_restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // The page's CSP must allow this build's own isolation frame, whose scheme is made at compile time: see `isolation_csp`.
  let mut context = tauri::generate_context!();
  let isolation_scheme = isolation_csp::allow_isolation_frame(&mut context);

  let builder = tauri::Builder::default();
  // Restores the window as it was left: size, position, maximized (F13). Full screen is
  // left out: the plugin records it at quit, which saved `false` whenever a quit landed
  // while the window was briefly windowed (fullscreen.rs); this file records it instead.
  // On the builder, not in `setup`: registered there it arrives after the window
  // is created, never tracks it, and saves an empty state.
  #[cfg(desktop)]
  let builder = builder.plugin(
    tauri_plugin_window_state::Builder::default()
      .with_state_flags(tauri_plugin_window_state::StateFlags::all() - tauri_plugin_window_state::StateFlags::FULLSCREEN)
      .build(),
  );
  // Checks for a release and installs one signed with the owner's key; the key, the address and `requireSignedVersion` are in
  // `tauri.conf.json` (task 20.10a, docs/security-review.md section 13). Nothing runs until the page asks, and the hook admits
  // only the calls the client makes.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
  // macOS ignores the plugin's full-screen restore: it runs before the window is on
  // screen, so the window only gets the screen's size. When it was left in full
  // screen, enter it again the first time the (now visible) window takes focus.
  #[cfg(desktop)]
  let builder = builder.on_window_event(|window, event| match event {
    tauri::WindowEvent::Focused(true) => {
      if PENDING_FULLSCREEN.swap(false, Ordering::SeqCst) {
        let _ = window.set_fullscreen(true);
      }
    }
    // Entering or leaving full screen resizes the window: record the change, if it is one.
    tauri::WindowEvent::Resized(_) => {
      use tauri::Manager;

      let Ok(now) = window.is_fullscreen() else { return };
      if let Some(change) = with_tracker(|tracker| tracker.observe(now)).flatten() {
        if let Some(dir) = config_dir(window.app_handle()) {
          if let Err(error) = fullscreen::write(&dir, change) {
            log::warn!("could not record full screen: {error}");
          }
        }
      }
    }
    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
      with_tracker(fullscreen::Tracker::closing);
    }
    _ => {}
  });

  builder
    .invoke_handler(tauri::generate_handler![relaunch])
    // Keeps the window on the app's own page: nothing else may be navigated to (SR-015, navigation.rs).
    .plugin(navigation::guard(isolation_scheme))
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_http::init())
    // Opens the About page's links in the system browser, never in the app's own window (task 11.21).
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      #[cfg(desktop)]
      let left_in_fullscreen = config_dir(app.handle())
        .map(|dir| fullscreen::left_in_fullscreen(&dir, tauri_plugin_window_state::DEFAULT_FILENAME))
        .unwrap_or(false);
      #[cfg(desktop)]
      if let Ok(mut tracker) = TRACKER.lock() {
        *tracker = Some(fullscreen::Tracker::new(left_in_fullscreen));
      }
      #[cfg(desktop)]
      if left_in_fullscreen {
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
            with_tracker(fullscreen::Tracker::restore_gave_up);
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
    .build(context)
    .expect("error while building tauri application")
    .run(|_app, event| {
      // Cmd+Q: the app is quitting, and whatever the window does from here is not a choice.
      if let tauri::RunEvent::ExitRequested { .. } = event {
        with_tracker(fullscreen::Tracker::closing);
      }
    });
}
