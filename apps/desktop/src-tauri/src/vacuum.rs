//! Gives the database file its free space back at start (BL-151).
//!
//! Deleting a list frees its pages inside `listulator.sqlite`. SQLite keeps them for reuse but never returns them, so the file
//! stays as big as its biggest moment, and the deleted lists' titles stay readable in the free pages (the owner's Windows dev
//! database: 31 MB for one list of 77 items, 99.6% free pages). When the free space is worth the rewrite the file is vacuumed.
//!
//! It has to be done here: the webview's hook (`isolation/hook.js`) refuses the word `vacuum`, on purpose. And it has to be done
//! before the page connects. `lib.rs` runs it first thing in `setup`, which Tauri runs on the main thread inside the event loop's
//! first callback; the page's calls (the SQL plugin's `load` among them) are answered by that same loop, so none can arrive while
//! it runs. The server does the same in `server/src/db/reclaimSpace.ts`; the two thresholds are equal, and
//! `vacuumThresholds.guard.test.ts` reads both.
//!
//! Never stops the start. A missing file (first run), a file that is not a database, another process holding it, a full disk: the
//! outcome is `Skipped` or `NotWorthIt` and the app starts as it would have. A failed `VACUUM` leaves the original whole.

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection, Row, SqliteConnection};
use std::path::Path;
use std::time::Duration;

/// The file the SQL plugin opens (`sqlite:listulator.sqlite`, in the app's config folder).
pub const DATABASE_FILE: &str = "listulator.sqlite";

/// At least this much would come back (a small file is never rewritten for a few pages)...
pub const MIN_FREE_BYTES: u64 = 8 * 1024 * 1024;
/// ...and at least one page in this many of the file is free (a quarter).
pub const MIN_FREE_SHARE_DENOMINATOR: u64 = 4;

/// How long to wait for another process that holds the file. Short: this runs in `setup`, before the window is shown, and giving up costs
/// nothing (the next start tries again).
const BUSY: Duration = Duration::from_millis(250);

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
  /// No file, or not enough free space to be worth the rewrite.
  NotWorthIt,
  /// The file was rewritten: its size before and after, in bytes.
  Vacuumed { before: u64, after: u64 },
  /// Something stopped it (the reason, for the log); the file is as it was.
  Skipped(String),
}

/// Both: at least `MIN_FREE_BYTES` free, and at least a quarter of the pages.
pub fn worth_vacuuming(page_size: u64, page_count: u64, freelist_count: u64) -> bool {
  if page_size == 0 || page_count == 0 {
    return false;
  }

  freelist_count.saturating_mul(page_size) >= MIN_FREE_BYTES && freelist_count.saturating_mul(MIN_FREE_SHARE_DENOMINATOR) >= page_count
}

/// Vacuums `path` when `worth_vacuuming` says so. Blocks until it is done (it is run before the window can use the file).
pub fn reclaim(path: &Path) -> Outcome {
  reclaim_waiting(path, BUSY)
}

fn reclaim_waiting(path: &Path, busy: Duration) -> Outcome {
  let Ok(metadata) = std::fs::metadata(path) else {
    return Outcome::NotWorthIt;
  };
  let before = metadata.len();

  match tauri::async_runtime::block_on(run(path, busy)) {
    Ok(true) => Outcome::Vacuumed { before, after: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) },
    Ok(false) => Outcome::NotWorthIt,
    Err(error) => Outcome::Skipped(error.to_string()),
  }
}

async fn run(path: &Path, busy: Duration) -> Result<bool, sqlx::Error> {
  // Never creates a file. Connecting with sqlx's defaults (WAL, foreign keys on) is how the SQL plugin opens it too, and the app's database is
  // WAL already (the plugin made it so), so connecting here changes nothing.
  let mut connection = SqliteConnectOptions::new().filename(path).create_if_missing(false).busy_timeout(busy).connect().await?;
  let outcome = vacuum_if_worth_it(&mut connection).await;
  // A close that fails changes nothing that was done.
  let _ = connection.close().await;

  outcome
}

async fn pragma(connection: &mut SqliteConnection, name: &'static str) -> Result<u64, sqlx::Error> {
  let value: i64 = sqlx::query(&format!("PRAGMA {name}")).fetch_one(&mut *connection).await?.try_get(0)?;

  Ok(u64::try_from(value).unwrap_or(0))
}

async fn vacuum_if_worth_it(connection: &mut SqliteConnection) -> Result<bool, sqlx::Error> {
  let page_size = pragma(connection, "page_size").await?;
  let page_count = pragma(connection, "page_count").await?;
  let freelist_count = pragma(connection, "freelist_count").await?;
  if !worth_vacuuming(page_size, page_count, freelist_count) {
    return Ok(false);
  }

  sqlx::query("VACUUM").execute(&mut *connection).await?;
  // A WAL database writes the vacuumed copy to its log first: fold it into the file, so the file really is small.
  sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").fetch_all(&mut *connection).await?;

  Ok(true)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::PathBuf;

  const MIB: u64 = 1024 * 1024;

  #[test]
  fn needs_both_a_big_enough_free_space_and_a_big_enough_share() {
    // 8 MiB free of 10 MiB: both.
    assert!(worth_vacuuming(4096, 2560, 2048));
    // 8 MiB free but of 100 MiB: a small share, left alone.
    assert!(!worth_vacuuming(4096, 25600, 2048));
    // Most of the file free, but only 1 MiB of it: not worth the rewrite.
    assert!(!worth_vacuuming(4096, 300, 256));
  }

  #[test]
  fn has_its_edges_where_the_constants_say() {
    assert_eq!(MIN_FREE_BYTES, 8 * MIB);
    assert_eq!(MIN_FREE_SHARE_DENOMINATOR, 4);
    let pages = MIN_FREE_BYTES / 4096;
    assert!(worth_vacuuming(4096, pages * 4, pages));
    assert!(!worth_vacuuming(4096, pages * 4, pages - 1));
    assert!(!worth_vacuuming(4096, pages * 4 + 4, pages));
  }

  #[test]
  fn an_empty_or_unreadable_count_is_never_worth_it() {
    assert!(!worth_vacuuming(4096, 0, 0));
    assert!(!worth_vacuuming(0, 10, 10));
  }

  /// A folder of its own for one test, removed after.
  struct Scratch(PathBuf);

  impl Scratch {
    fn new(name: &str) -> Scratch {
      let path = std::env::temp_dir().join(format!("listulator-vacuum-{name}-{}", std::process::id()));
      let _ = std::fs::remove_dir_all(&path);
      std::fs::create_dir_all(&path).unwrap();
      Scratch(path)
    }

    fn file(&self) -> PathBuf {
      self.0.join(DATABASE_FILE)
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }

  async fn open(path: &Path) -> SqliteConnection {
    SqliteConnectOptions::new().filename(path).create_if_missing(true).connect().await.unwrap()
  }

  /// A database like the owner's: a few live rows, and a big list that was imported (and, if `delete`, deleted).
  fn make(path: &Path, delete: bool) {
    tauri::async_runtime::block_on(async {
      let mut connection = open(path).await;
      for statement in [
        "CREATE TABLE lists (id TEXT PRIMARY KEY, title TEXT)",
        "CREATE TABLE items (id INTEGER PRIMARY KEY, list_id TEXT, title TEXT)",
        "INSERT INTO lists VALUES ('keep', 'Kept'), ('big', 'Big test list')",
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 77) INSERT INTO items (list_id, title) SELECT 'keep', 'Kept item ' || x FROM c",
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 60000) INSERT INTO items (list_id, title) SELECT 'big', 'Midnight Harbor #' || x || ' ' || hex(randomblob(60)) FROM c",
      ] {
        sqlx::query(statement).execute(&mut connection).await.unwrap();
      }
      if delete {
        sqlx::query("DELETE FROM items WHERE list_id = 'big'").execute(&mut connection).await.unwrap();
        sqlx::query("DELETE FROM lists WHERE id = 'big'").execute(&mut connection).await.unwrap();
      }
      sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").fetch_all(&mut connection).await.unwrap();
      connection.close().await.unwrap();
    });
  }

  fn count(path: &Path, table: &str) -> i64 {
    tauri::async_runtime::block_on(async {
      let mut connection = open(path).await;
      let n = sqlx::query(&format!("SELECT count(*) FROM {table}")).fetch_one(&mut connection).await.unwrap().try_get(0).unwrap();
      let _ = connection.close().await;

      n
    })
  }

  fn text_in(path: &Path, needle: &str) -> bool {
    std::fs::read(path).unwrap().windows(needle.len()).any(|window| window == needle.as_bytes())
  }

  #[test]
  fn shrinks_a_file_that_is_mostly_free_pages_and_keeps_every_live_row() {
    let scratch = Scratch::new("shrinks");
    make(&scratch.file(), true);
    let before = std::fs::metadata(scratch.file()).unwrap().len();
    assert!(before > MIN_FREE_BYTES);
    assert!(text_in(&scratch.file(), "Midnight Harbor"), "the deleted list's text is still in the free pages");

    let outcome = reclaim(&scratch.file());

    let Outcome::Vacuumed { before: reported, after } = outcome else { panic!("expected a vacuum, got {outcome:?}") };
    assert_eq!(reported, before);
    assert!(after < before / 20, "{after} should be far below {before}");
    assert_eq!(std::fs::metadata(scratch.file()).unwrap().len(), after);
    assert_eq!(count(&scratch.file(), "items"), 77);
    assert_eq!(count(&scratch.file(), "lists"), 1);
    assert!(!text_in(&scratch.file(), "Midnight Harbor"), "nothing of the deleted list is left in the file");
  }

  #[test]
  fn leaves_a_file_alone_that_has_no_worthwhile_free_space() {
    let scratch = Scratch::new("alone");
    make(&scratch.file(), false);
    let before = std::fs::metadata(scratch.file()).unwrap().len();

    assert_eq!(reclaim(&scratch.file()), Outcome::NotWorthIt);
    assert_eq!(std::fs::metadata(scratch.file()).unwrap().len(), before);
  }

  #[test]
  fn a_database_that_is_not_there_is_not_created() {
    let scratch = Scratch::new("missing");

    assert_eq!(reclaim(&scratch.file()), Outcome::NotWorthIt);
    assert!(!scratch.file().exists());
  }

  #[test]
  fn a_file_that_is_not_a_database_is_skipped_and_left_as_it_was() {
    let scratch = Scratch::new("notdb");
    std::fs::write(scratch.file(), "this is not a database".repeat(1000)).unwrap();
    let before = std::fs::read(scratch.file()).unwrap();

    assert!(matches!(reclaim(&scratch.file()), Outcome::Skipped(_)));
    assert_eq!(std::fs::read(scratch.file()).unwrap(), before);
  }

  #[test]
  fn the_wait_for_a_held_file_is_short_because_it_blocks_the_first_window() {
    let scratch = Scratch::new("short-wait");
    make(&scratch.file(), true);
    let mut holder = tauri::async_runtime::block_on(async {
      let mut holder = open(&scratch.file()).await;
      sqlx::query("BEGIN EXCLUSIVE").execute(&mut holder).await.unwrap();

      holder
    });

    let started = std::time::Instant::now();
    let outcome = reclaim(&scratch.file());
    let waited = started.elapsed();

    tauri::async_runtime::block_on(async {
      sqlx::query("ROLLBACK").execute(&mut holder).await.unwrap();
      let _ = holder.close().await;
    });
    assert!(matches!(outcome, Outcome::Skipped(_)), "got {outcome:?}");
    // It runs in `setup`, before the window is shown: a second app instance holding the file must not leave a blank window for seconds.
    assert!(waited < Duration::from_millis(1000), "waited {waited:?}");
  }

  #[test]
  fn gives_up_quietly_when_another_connection_holds_the_file() {
    let scratch = Scratch::new("locked");
    make(&scratch.file(), true);
    let before = std::fs::metadata(scratch.file()).unwrap().len();

    // The holder is made and released on the runtime, but `reclaim_waiting` runs on this thread: it starts its own `block_on`.
    let mut holder = tauri::async_runtime::block_on(async {
      let mut holder = open(&scratch.file()).await;
      sqlx::query("BEGIN EXCLUSIVE").execute(&mut holder).await.unwrap();

      holder
    });
    let outcome = reclaim_waiting(&scratch.file(), Duration::from_millis(50));
    tauri::async_runtime::block_on(async {
      sqlx::query("ROLLBACK").execute(&mut holder).await.unwrap();
      let _ = holder.close().await;
    });

    assert!(matches!(outcome, Outcome::Skipped(_)), "got {outcome:?}");
    assert_eq!(std::fs::metadata(scratch.file()).unwrap().len(), before);
  }
}
