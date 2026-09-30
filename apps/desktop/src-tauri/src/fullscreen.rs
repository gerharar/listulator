//! Whether the window comes back in full screen (F13, and the 2026-09-30 regression).
//!
//! The window-state plugin records full screen at the moment the app quits. A quit that
//! lands while the window is not in full screen (a dev rebuild restarting the app, the
//! launch's own full-screen animation still running, macOS taking the window out of full
//! screen as it closes) saved `false`, and the next launch came back windowed although the
//! owner never left full screen. So the plugin no longer records full screen; this module
//! does, and only from a change seen while the app runs normally: never during the
//! launch's restore, never once the app is closing, and never at quit.

use std::path::Path;

/// Our own record, beside the plugin's `.window-state.json` in the app's config folder.
pub const FILE_NAME: &str = "fullscreen.json";

/// What the last run recorded. Falls back to the plugin's own file, which is where this
/// used to live, so the first launch after the change still restores full screen.
pub fn left_in_fullscreen(dir: &Path, legacy_file_name: &str) -> bool {
  read(dir).or_else(|| legacy(dir, legacy_file_name)).unwrap_or(false)
}

pub fn read(dir: &Path) -> Option<bool> {
  let text = std::fs::read_to_string(dir.join(FILE_NAME)).ok()?;
  serde_json::from_str::<serde_json::Value>(&text).ok()?.get("fullscreen")?.as_bool()
}

pub fn write(dir: &Path, fullscreen: bool) -> std::io::Result<()> {
  std::fs::create_dir_all(dir)?;
  // Written whole to a temporary file and moved over, so a quit mid-write leaves the old record.
  let temporary = dir.join(format!("{FILE_NAME}.tmp"));
  std::fs::write(&temporary, serde_json::json!({ "fullscreen": fullscreen }).to_string())?;
  std::fs::rename(temporary, dir.join(FILE_NAME))
}

fn legacy(dir: &Path, legacy_file_name: &str) -> Option<bool> {
  let text = std::fs::read_to_string(dir.join(legacy_file_name)).ok()?;
  serde_json::from_str::<serde_json::Value>(&text).ok()?.get("main")?.get("fullscreen")?.as_bool()
}

/// Decides which observed full-screen states are worth recording.
#[derive(Debug)]
pub struct Tracker {
  recorded: bool,
  restoring: bool,
  closing: bool,
}

impl Tracker {
  /// `recorded` is what the file says at launch. When it says full screen, the launch is
  /// about to restore it, and until that has happened the window is windowed on purpose.
  pub fn new(recorded: bool) -> Self {
    Self { recorded, restoring: recorded, closing: false }
  }

  /// The window's full-screen state was seen (it was resized). Returns the value to record,
  /// or `None` when nothing should be written.
  pub fn observe(&mut self, fullscreen: bool) -> Option<bool> {
    if self.closing {
      return None;
    }
    if self.restoring {
      if fullscreen {
        self.restoring = false;
      }
      return None;
    }
    if fullscreen == self.recorded {
      return None;
    }
    self.recorded = fullscreen;
    Some(fullscreen)
  }

  /// The launch gave up on full screen: from now on the window's state is its own.
  pub fn restore_gave_up(&mut self) {
    self.restoring = false;
  }

  /// The app or its window is closing: whatever the window does now is not the owner's choice.
  pub fn closing(&mut self) {
    self.closing = true;
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const LEGACY: &str = ".window-state.json";

  fn folder() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
      "listulator-fullscreen-{}-{}",
      std::process::id(),
      std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn the_regression_a_quit_while_windowed_right_after_launch_keeps_full_screen() {
    // Left in full screen; the next launch starts windowed and is closed (a dev rebuild)
    // before the restore finishes. Nothing is recorded, so the launch after restores it.
    let dir = folder();
    write(&dir, true).unwrap();
    let mut tracker = Tracker::new(left_in_fullscreen(&dir, LEGACY));

    assert_eq!(tracker.observe(false), None);
    tracker.closing();
    assert_eq!(tracker.observe(false), None);

    assert!(left_in_fullscreen(&dir, LEGACY));
  }

  #[test]
  fn closing_never_records_the_window_leaving_full_screen() {
    let mut tracker = Tracker::new(true);
    assert_eq!(tracker.observe(true), None); // restored

    tracker.closing();

    assert_eq!(tracker.observe(false), None);
  }

  #[test]
  fn leaving_full_screen_while_the_app_runs_is_recorded_and_the_next_launch_is_windowed() {
    let dir = folder();
    let mut tracker = Tracker::new(true);
    assert_eq!(tracker.observe(true), None); // restored

    let change = tracker.observe(false);
    assert_eq!(change, Some(false));
    write(&dir, change.unwrap()).unwrap();

    assert!(!left_in_fullscreen(&dir, LEGACY));
  }

  #[test]
  fn entering_full_screen_while_the_app_runs_is_recorded_once() {
    let mut tracker = Tracker::new(false);

    assert_eq!(tracker.observe(false), None);
    assert_eq!(tracker.observe(true), Some(true));
    assert_eq!(tracker.observe(true), None);
  }

  #[test]
  fn a_restore_that_gave_up_leaves_the_window_its_own_state() {
    let mut tracker = Tracker::new(true);
    assert_eq!(tracker.observe(false), None);

    tracker.restore_gave_up();

    assert_eq!(tracker.observe(false), Some(false));
  }

  #[test]
  fn the_first_launch_after_the_change_reads_the_plugins_old_record() {
    let dir = folder();
    std::fs::write(dir.join(LEGACY), r#"{"main":{"width":800,"fullscreen":true}}"#).unwrap();

    assert!(left_in_fullscreen(&dir, LEGACY));

    write(&dir, false).unwrap();
    assert!(!left_in_fullscreen(&dir, LEGACY)); // our own record wins from then on
  }

  #[test]
  fn nothing_recorded_means_windowed() {
    assert!(!left_in_fullscreen(&folder(), LEGACY));
  }
}
