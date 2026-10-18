//! Holds back the window's own ways of closing while a whole-list run goes on (H-015).
//!
//! A Reset, Restore order or Undo rewrites a whole list from the page; the desktop database has no transactions, so a run that is cut short
//! leaves the list half-done (23,000 of 30,000 items in the owner's test). The app header's Quit asks first, but the window's close button
//! and Alt+F4 never went through it. While the page holds, a close of the window is not carried out: the page is told, and shows the same
//! question. Not covered: Cmd+Q on a Mac. The system's Quit item is AppKit's `terminate:`, which goes to `applicationWillTerminate` and the
//! end of the loop without a Tauri `ExitRequested` event (tao 0.37), so there is nothing to refuse; holding it would take replacing that menu item.
//!
//! The hold is a lease. The page renews it every few seconds while the run goes on and lets go when it ends; one that is not renewed
//! lapses after `LEASE`, so a page that hangs cannot make the app impossible to close.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// How long a hold lasts without being renewed. The page renews it every five seconds.
pub const LEASE: Duration = Duration::from_secs(20);

/// The event the page listens for: a close or a quit was held back.
pub const EVENT: &str = "quit-while-running";

static START: OnceLock<Instant> = OnceLock::new();
/// The moment the hold lapses, in milliseconds since `START`; 0 means no hold.
static HELD_UNTIL: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
  START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

/// Whether a hold that lapses at `until` still holds at `now` (both in milliseconds; 0 never holds).
fn held_at(until: u64, now: u64) -> bool {
  until > now
}

/// The page holds the window's close for one more `LEASE`, or lets go.
pub fn hold(held: bool) {
  HELD_UNTIL.store(if held { now_ms() + LEASE.as_millis() as u64 } else { 0 }, Ordering::SeqCst);
}

/// A close of the window asked for now must be held back.
pub fn is_held() -> bool {
  held_at(HELD_UNTIL.load(Ordering::SeqCst), now_ms())
}

/// Tells the page that a close was held back, so it can ask, and brings the window to the front: a close from the taskbar or the Dock while the
/// window is minimised would otherwise put the question in a window nobody can see.
pub fn ask(app: &tauri::AppHandle) {
  use tauri::{Emitter, Manager};

  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
  if let Err(error) = app.emit(EVENT, ()) {
    log::warn!("could not ask the page about a held close: {error}");
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_hold_lasts_until_its_moment_and_not_a_millisecond_longer() {
    assert!(held_at(20_000, 0));
    assert!(held_at(20_000, 19_999));
    assert!(!held_at(20_000, 20_000));
    assert!(!held_at(20_000, 25_000));
  }

  #[test]
  fn no_hold_is_zero_and_never_holds() {
    assert!(!held_at(0, 0));
    assert!(!held_at(0, 5));
  }

  #[test]
  fn the_lease_is_longer_than_the_page_takes_to_renew_it() {
    // The page renews every five seconds (`HOLD_RENEW_MS` in appQuit.ts): at least three renewals fit in a lease.
    assert!(LEASE >= Duration::from_secs(15));
  }

  /// The one test that touches the process-wide hold, so that no other test can race it.
  #[test]
  fn holding_and_letting_go() {
    hold(false);
    assert!(!is_held());

    hold(true);
    assert!(is_held());

    hold(false);
    assert!(!is_held());
  }
}
