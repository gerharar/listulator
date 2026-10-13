//! Keeps the window-state file current while the app runs (BL-088, SR-075).
//!
//! The window-state plugin writes the window's size, position and maximized flag only at a normal close or exit. On Windows
//! the updater starts the installer and ends the app with `std::process::exit(0)`: no close, no exit event, nothing written,
//! so the next start restored whatever the last normal quit had left (a window maximized in this session came back
//! normal-sized). The window therefore asks for a save a moment after it last moved or resized, the same save a normal exit
//! makes, so the file is right whichever way the process ends.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// How long after the last move or resize the file is written: a drag is one write, not hundreds.
pub const DELAY: Duration = Duration::from_millis(800);

/// Runs `action` once, `delay` from now, on its own thread (so `action` must not call into the window itself: hand over to the
/// main thread, as `lib.rs` does). A call made while one is waiting is dropped: the action reads the
/// window as it is when it runs, so the last change is always the one saved. `pending` is the caller's own flag.
pub fn schedule(pending: &'static AtomicBool, delay: Duration, action: impl FnOnce() + Send + 'static) {
  if pending.swap(true, Ordering::SeqCst) {
    return;
  }

  std::thread::spawn(move || {
    std::thread::sleep(delay);
    pending.store(false, Ordering::SeqCst);
    action();
  });
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::AtomicUsize;
  use std::sync::Arc;

  fn pause() {
    std::thread::sleep(Duration::from_millis(150));
  }

  #[test]
  fn many_calls_inside_the_delay_make_one_run() {
    static PENDING: AtomicBool = AtomicBool::new(false);
    let runs = Arc::new(AtomicUsize::new(0));

    for _ in 0..50 {
      let runs = Arc::clone(&runs);
      schedule(&PENDING, Duration::from_millis(40), move || {
        runs.fetch_add(1, Ordering::SeqCst);
      });
    }
    pause();

    assert_eq!(runs.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn a_call_after_a_run_schedules_the_next_one() {
    static PENDING: AtomicBool = AtomicBool::new(false);
    let runs = Arc::new(AtomicUsize::new(0));
    let ask = || {
      let runs = Arc::clone(&runs);
      schedule(&PENDING, Duration::from_millis(20), move || {
        runs.fetch_add(1, Ordering::SeqCst);
      });
    };

    ask();
    pause();
    ask();
    pause();

    assert_eq!(runs.load(Ordering::SeqCst), 2);
  }

  #[test]
  fn the_run_comes_after_the_delay_not_at_the_call() {
    static PENDING: AtomicBool = AtomicBool::new(false);
    let runs = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&runs);

    schedule(&PENDING, Duration::from_millis(120), move || {
      counted.fetch_add(1, Ordering::SeqCst);
    });

    assert_eq!(runs.load(Ordering::SeqCst), 0);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(runs.load(Ordering::SeqCst), 1);
  }

  #[test]
  fn the_delay_is_short_enough_to_beat_an_update_and_long_enough_to_batch_a_drag() {
    assert!(DELAY >= Duration::from_millis(300));
    assert!(DELAY <= Duration::from_secs(2));
  }
}
