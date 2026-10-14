//! Brings a restored window back onto the screen (BL-095).
//!
//! The window-state plugin puts the window back at the size and position it was saved with, and only checks that the saved
//! position touches some monitor, never that the window fits the monitor's usable area (the screen less the taskbar or the menu
//! bar and dock). A size saved on another monitor, at another scale, or before the taskbar moved can therefore come back with the
//! bottom edge under the taskbar, where it cannot be grabbed, and Windows keeps a title bar from being dragged higher. This works
//! out what to change so the window lies inside the usable area; `lib.rs` asks for it once, when the window is first in its normal
//! state (not maximized, not full screen, not minimized), and applies it.
//!
//! Everything is in physical pixels, the unit the window, the monitors and the plugin's file all use.

/// How far a side may stick out before the window is moved. On Windows a window that fits exactly still reports an invisible
/// resize border of about 8 pixels at 100% scale on the left, right and bottom (more at higher scales), so a window snapped
/// against an edge is not outside.
pub const TOLERANCE: i64 = 24;

/// A rectangle on the desktop: where its top-left corner is and how big it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
  pub x: i32,
  pub y: i32,
  pub width: u32,
  pub height: u32,
}

/// What to change: by how much to shrink the window (0 for none) and where to put its top-left corner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fit {
  pub shrink_width: u32,
  pub shrink_height: u32,
  pub x: i32,
  pub y: i32,
}

/// Where a span `start .. start + length` has to start to lie inside `low .. low + room`, as near to where it is as it can be.
fn clamp_start(start: i64, length: i64, low: i64, room: i64) -> i64 {
  start.clamp(low, low + room - length)
}

/// `None` when the window is inside `work` (give or take `TOLERANCE`); otherwise the shrink and the position that put all of it
/// inside: no larger than `work`, and as near to where it was as it can be.
pub fn fit(window: Rect, work: Rect) -> Option<Fit> {
  let (wx, wy, ww, wh) = (i64::from(work.x), i64::from(work.y), i64::from(work.width), i64::from(work.height));
  let (x, y, w, h) = (i64::from(window.x), i64::from(window.y), i64::from(window.width), i64::from(window.height));

  let outside = [wx - x, wy - y, (x + w) - (wx + ww), (y + h) - (wy + wh)];
  if outside.iter().all(|side| *side <= TOLERANCE) {
    return None;
  }

  let width = w.min(ww);
  let height = h.min(wh);

  Some(Fit {
    shrink_width: (w - width) as u32,
    shrink_height: (h - height) as u32,
    x: clamp_start(x, width, wx, ww) as i32,
    y: clamp_start(y, height, wy, wh) as i32,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  const fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
    Rect { x, y, width, height }
  }

  /// The owner's screen (1.0.1, 2026-10-14): a 3440 x 1440 monitor right of a 1920-wide one, 125% scale, taskbar at the bottom
  /// (about 50 pixels): usable area 1920, 0 to 5360, 1390.
  const ULTRAWIDE: Rect = rect(1920, 0, 3440, 1390);

  #[test]
  fn leaves_a_window_that_fits_alone() {
    assert_eq!(fit(rect(2200, 100, 1200, 800), ULTRAWIDE), None);
    assert_eq!(fit(rect(1920, 0, 3440, 1390), ULTRAWIDE), None);
  }

  #[test]
  fn shrinks_the_owners_window_whose_bottom_was_under_the_taskbar() {
    // Saved inner size 1142 x 1415 at 1926, 0: with the title bar and borders the whole window is taller than the monitor.
    let fit = fit(rect(1926, 0, 1160, 1470), ULTRAWIDE).unwrap();

    assert_eq!(fit, Fit { shrink_width: 0, shrink_height: 80, x: 1926, y: 0 });
  }

  #[test]
  fn moves_up_a_window_that_fits_but_hangs_below_the_taskbar() {
    assert_eq!(
      fit(rect(2000, 1200, 800, 600), ULTRAWIDE),
      Some(Fit { shrink_width: 0, shrink_height: 0, x: 2000, y: 790 })
    );
  }

  #[test]
  fn moves_in_a_window_that_sticks_out_to_the_left_or_the_right() {
    assert_eq!(fit(rect(1500, 100, 800, 600), ULTRAWIDE).map(|f| (f.x, f.y)), Some((1920, 100)));
    assert_eq!(fit(rect(5100, 100, 800, 600), ULTRAWIDE).map(|f| (f.x, f.y)), Some((4560, 100)));
  }

  #[test]
  fn moves_a_window_down_from_under_a_taskbar_at_the_top() {
    let top_taskbar = rect(0, 50, 1920, 1030);

    assert_eq!(fit(rect(100, 0, 800, 600), top_taskbar).map(|f| f.y), Some(50));
  }

  #[test]
  fn shrinks_a_window_larger_than_the_screen_in_both_directions() {
    let laptop = rect(0, 0, 1366, 728);

    assert_eq!(
      fit(rect(-50, -20, 2000, 1200), laptop),
      Some(Fit { shrink_width: 634, shrink_height: 472, x: 0, y: 0 })
    );
  }

  #[test]
  fn does_not_count_the_invisible_resize_border_as_outside() {
    // A window snapped to the left, right and bottom edges of the usable area reports about 8 pixels (more at higher scales) more.
    assert_eq!(fit(rect(1912, 0, 3456, 1398), ULTRAWIDE), None);
    assert_eq!(fit(rect(1920 - TOLERANCE as i32, 0, 800, 600), ULTRAWIDE), None);
    assert!(fit(rect(1920 - TOLERANCE as i32 - 1, 0, 800, 600), ULTRAWIDE).is_some());
  }

  #[test]
  fn does_not_overflow_at_the_ends_of_the_number_ranges() {
    let huge = rect(i32::MIN, i32::MIN, u32::MAX, u32::MAX);
    let fitted = fit(huge, ULTRAWIDE).unwrap();

    assert_eq!((fitted.x, fitted.y), (1920, 0));
    assert_eq!((fitted.shrink_width, fitted.shrink_height), (u32::MAX - 3440, u32::MAX - 1390));
    assert!(fit(rect(i32::MAX, i32::MAX, 10, 10), ULTRAWIDE).is_some());
  }

  #[test]
  fn what_it_asks_for_always_fits() {
    for x in (-3000..8000).step_by(499) {
      for y in (-2000..3000).step_by(311) {
        for (w, h) in [(300_u32, 200_u32), (1200, 900), (3600, 1500), (6000, 3000)] {
          let Some(f) = fit(rect(x, y, w, h), ULTRAWIDE) else { continue };
          let (nw, nh) = (i64::from(w - f.shrink_width), i64::from(h - f.shrink_height));

          assert!(i64::from(f.x) >= i64::from(ULTRAWIDE.x) && i64::from(f.x) + nw <= i64::from(ULTRAWIDE.x) + 3440);
          assert!(i64::from(f.y) >= i64::from(ULTRAWIDE.y) && i64::from(f.y) + nh <= i64::from(ULTRAWIDE.y) + 1390);
        }
      }
    }
  }
}
