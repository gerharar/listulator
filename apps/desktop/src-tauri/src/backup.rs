//! A copy of the database the first time a new version starts (Phase 52).
//!
//! The whole library is one SQLite file and nothing copied it. The desktop applies a migration statement by statement, with no
//! transaction, so a migration that stops half-way (a rebuilt table, a closed laptop) could leave the file in a state the next version
//! cannot open. This keeps the file as the previous version left it: `backups/listulator-before-<running version>-<UTC date and time>.sqlite`
//! beside the database, the newest three kept. docs/DECISIONS.md, "Task 52.0 (spike)", has the measurements and the reasons.
//!
//! The copy is `VACUUM INTO`, not a file copy: the database is WAL, and a copy of the main file without its `-wal` is stale. `VACUUM INTO`
//! reads in one transaction and writes one self-contained file. It is made under a `.partial` name and renamed, so a copy that stops half-way
//! is never counted, and never pushes a good one out.
//!
//! When: `lib.rs` runs it first thing in `setup`, before `vacuum::reclaim` (a copy of what the previous version left, not of a rewritten
//! file) and, like it, before the page can connect (vacuum.rs says why that holds). A small text file, `last-version.txt`, beside the
//! database says which version started last: no database is a first install (the marker only); a database with no marker is the first start
//! of a version that has this (the 1.4.0 upgrade); a marker that differs from the running version is an upgrade; the same version does
//! nothing. The marker is written only after the copy is in place, so a copy that failed is tried again at the next start.
//!
//! Never stops the start. Every failure (no space, a folder that cannot be made, a file that is not a database) is an `Outcome::Skipped`
//! and the app starts as it would have. The folder also holds copies made by hand in September; only names of this module's own shape are
//! ever counted or deleted.

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::vacuum::DATABASE_FILE;

/// Beside the database: the version that started last, as plain text.
pub const MARKER_FILE: &str = "last-version.txt";
/// Beside the database: the folder of copies.
pub const BACKUP_FOLDER: &str = "backups";
/// A copy is `<PREFIX><version>-<stamp><SUFFIX>`; the guide `guides/` names this shape (52.3).
pub const PREFIX: &str = "listulator-before-";
pub const SUFFIX: &str = ".sqlite";
/// A copy in the making; never counted, removed when found.
const PARTIAL: &str = ".partial";
/// How many copies are kept.
pub const KEEP: usize = 3;

/// How long to wait for another process that holds the file; the same as `vacuum.rs`, for the same reason (the window is not shown yet).
const BUSY: Duration = Duration::from_millis(250);

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
  /// The marker already names the running version.
  Unchanged,
  /// There was no database (a first install): only the marker was written.
  FirstInstall,
  /// The copy is in place and the marker updated: the copy's file name, and how many older ones were removed.
  BackedUp { name: String, pruned: usize },
  /// Something stopped it (the reason, for the log); the database is as it was.
  Skipped(String),
}

/// Takes the copy when the running `version` differs from the one that started last. `dir` is the app's config folder.
pub fn back_up(dir: &Path, version: &str) -> Outcome {
  let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|since| since.as_secs()).unwrap_or(0);

  back_up_at(dir, version, now)
}

fn back_up_at(dir: &Path, version: &str, now: u64) -> Outcome {
  let database = dir.join(DATABASE_FILE);
  let marker = dir.join(MARKER_FILE);

  match database.try_exists() {
    // A first install: nothing to keep yet. Decided by the file's existence, never by the marker's (a database with no marker is the 1.4.0 upgrade).
    Ok(false) => {
      return match std::fs::write(&marker, version) {
        Ok(()) => Outcome::FirstInstall,
        Err(error) => Outcome::Skipped(format!("marker not written: {error}")),
      }
    }
    Ok(true) => {}
    Err(error) => return Outcome::Skipped(format!("database not readable: {error}")),
  }
  // A marker that is missing, or not text, names no version.
  if std::fs::read_to_string(&marker).is_ok_and(|seen| seen.trim() == version) {
    return Outcome::Unchanged;
  }

  let folder = dir.join(BACKUP_FOLDER);
  if let Err(error) = std::fs::create_dir_all(&folder) {
    return Outcome::Skipped(format!("backups folder not made: {error}"));
  }
  let name = format!("{PREFIX}{version}-{}{SUFFIX}", utc_stamp(now));
  let partial = folder.join(format!("{name}{PARTIAL}"));
  let _ = std::fs::remove_file(&partial);

  let made = tauri::async_runtime::block_on(copy(&database, &partial)).and_then(|()| std::fs::rename(&partial, folder.join(&name)).map_err(|error| error.to_string()));
  if let Err(error) = made {
    let _ = std::fs::remove_file(&partial);

    return Outcome::Skipped(format!("no copy made: {error}"));
  }
  if let Err(error) = std::fs::write(&marker, version) {
    return Outcome::Skipped(format!("copy {name} made, marker not written: {error}"));
  }

  Outcome::BackedUp { name, pruned: prune(&folder) }
}

/// One consistent file of the database as it is now, including what the running app has written to its log and not yet to the file.
async fn copy(database: &Path, to: &Path) -> Result<(), String> {
  let to = to.to_str().ok_or("the copy's path is not text")?;
  // Never creates the database. The connection is the one `vacuum.rs` opens, and the app's database is WAL already.
  let mut connection =
    SqliteConnectOptions::new().filename(database).create_if_missing(false).busy_timeout(BUSY).connect().await.map_err(|error| error.to_string())?;
  let outcome = sqlx::query("VACUUM INTO ?1").bind(to).execute(&mut connection).await;
  // A close that fails changes nothing that was done.
  let _ = connection.close().await;

  outcome.map(|_| ()).map_err(|error| error.to_string())
}

/// The stamp of one of our own copies' names, or `None` for any other file (the September copies, their sidecars, a look-alike).
fn stamp_of(file_name: &str) -> Option<&str> {
  let stem = file_name.strip_prefix(PREFIX)?.strip_suffix(SUFFIX)?;
  let stamp = stem.get(stem.len().checked_sub(15)?..)?;
  let bytes = stamp.as_bytes();
  let shaped = bytes.iter().enumerate().all(|(index, byte)| if index == 8 { *byte == b'-' } else { byte.is_ascii_digit() });

  // A version text comes first and is joined by a dash: `<version>-<stamp>`.
  (shaped && stem.len() > 16 && stem.as_bytes()[stem.len() - 16] == b'-').then_some(stamp)
}

/// Keeps the newest `KEEP` of our own copies, by the date in the name (`1.10.0` sorts before `1.9.0` as text); removes the rest and any
/// copy left half-made. Touches nothing else. Returns how many copies it removed.
fn prune(folder: &Path) -> usize {
  let Ok(entries) = std::fs::read_dir(folder) else { return 0 };
  let mut copies: Vec<(String, String)> = Vec::new();
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().into_owned();
    if name.starts_with(PREFIX) && name.ends_with(&format!("{SUFFIX}{PARTIAL}")) {
      let _ = std::fs::remove_file(entry.path());
    } else if let Some(stamp) = stamp_of(&name) {
      copies.push((stamp.to_string(), name));
    }
  }
  copies.sort();

  let excess = copies.len().saturating_sub(KEEP);
  copies.iter().take(excess).filter(|(_, name)| std::fs::remove_file(folder.join(name)).is_ok()).count()
}

/// `YYYYMMDD-HHMMSS` in UTC for a Unix time in seconds.
fn utc_stamp(seconds: u64) -> String {
  let days = (seconds / 86_400) as i64;
  let of_day = seconds % 86_400;
  // The civil date of a day count (Howard Hinnant's algorithm), shifted to start the year in March so the leap day comes last.
  let shifted = days + 719_468;
  let era = shifted.div_euclid(146_097);
  let day_of_era = shifted.rem_euclid(146_097);
  let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
  let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
  let month_index = (5 * day_of_year + 2) / 153;
  let day = day_of_year - (153 * month_index + 2) / 5 + 1;
  let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
  let year = year_of_era + era * 400 + i64::from(month <= 2);

  format!("{year:04}{month:02}{day:02}-{:02}{:02}{:02}", of_day / 3_600, of_day % 3_600 / 60, of_day % 60)
}

/// What the page is told when the lists will not load (52.3): where the copies are, and how many of ours there are.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
pub struct Info {
  pub folder: String,
  pub count: usize,
}

/// The copies of ours in `dir`'s backups folder, or `None` when there are none (the page says nothing then). Read-only.
pub fn existing(dir: &Path) -> Option<Info> {
  let folder = dir.join(BACKUP_FOLDER);
  let count = std::fs::read_dir(&folder).ok()?.flatten().filter(|entry| stamp_of(&entry.file_name().to_string_lossy()).is_some()).count();

  (count > 0).then(|| Info { folder: folder.to_string_lossy().into_owned(), count })
}

#[cfg(test)]
mod tests {
  use super::*;
  use sqlx::{Row, SqliteConnection};
  use std::path::PathBuf;

  /// A folder of its own for one test, removed after.
  struct Scratch(PathBuf);

  impl Scratch {
    fn new(name: &str) -> Scratch {
      let path = std::env::temp_dir().join(format!("listulator-backup-{name}-{}", std::process::id()));
      let _ = std::fs::remove_dir_all(&path);
      std::fs::create_dir_all(&path).unwrap();
      Scratch(path)
    }

    fn database(&self) -> PathBuf {
      self.0.join(DATABASE_FILE)
    }

    fn marker(&self) -> PathBuf {
      self.0.join(MARKER_FILE)
    }

    fn backups(&self) -> PathBuf {
      self.0.join(BACKUP_FOLDER)
    }

    /// The names in the backups folder, sorted (empty when there is no folder).
    fn backup_names(&self) -> Vec<String> {
      let Ok(entries) = std::fs::read_dir(self.backups()) else { return Vec::new() };
      let mut names: Vec<String> = entries.map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect();
      names.sort();

      names
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

  /// A small library: `lists` and `list_items`, the two tables the plan names. Closed again, so the log is folded into the file.
  fn make(path: &Path, lists: i64, items: i64) {
    tauri::async_runtime::block_on(async {
      let mut connection = open(path).await;
      for statement in [
        // The app's database is WAL (the SQL plugin made it so); this makes the test's the same, whatever a connection's defaults are.
        "PRAGMA journal_mode = WAL".to_string(),
        "CREATE TABLE lists (id INTEGER PRIMARY KEY, title TEXT)".to_string(),
        "CREATE TABLE list_items (id INTEGER PRIMARY KEY, list_id INTEGER, title TEXT)".to_string(),
        format!("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < {lists}) INSERT INTO lists (title) SELECT 'List ' || x FROM c"),
        format!("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < {items}) INSERT INTO list_items (list_id, title) SELECT 1, 'Item ' || x FROM c"),
      ] {
        sqlx::query(&statement).execute(&mut connection).await.unwrap();
      }
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

  /// 2023-11-14 22:13:20 UTC.
  const NOW: u64 = 1_700_000_000;
  const DAY: u64 = 86_400;

  #[test]
  fn the_stamp_is_the_utc_date_and_time() {
    assert_eq!(utc_stamp(0), "19700101-000000");
    assert_eq!(utc_stamp(NOW), "20231114-221320");
    // A leap day, and the last second of a year.
    assert_eq!(utc_stamp(951_782_400), "20000229-000000");
    assert_eq!(utc_stamp(1_704_067_199), "20231231-235959");
  }

  #[test]
  fn no_database_writes_the_marker_and_makes_no_backup() {
    let scratch = Scratch::new("first-install");

    assert_eq!(back_up_at(&scratch.0, "1.4.1", NOW), Outcome::FirstInstall);

    assert_eq!(std::fs::read_to_string(scratch.marker()).unwrap(), "1.4.1");
    assert!(!scratch.backups().exists(), "a first install has nothing to keep");
    assert!(!scratch.database().exists(), "and the database is not created");
  }

  #[test]
  fn a_database_with_no_marker_makes_exactly_one_backup_and_writes_the_marker() {
    let scratch = Scratch::new("no-marker");
    make(&scratch.database(), 28, 3692);

    let outcome = back_up_at(&scratch.0, "1.4.1", NOW);

    assert_eq!(outcome, Outcome::BackedUp { name: "listulator-before-1.4.1-20231114-221320.sqlite".to_string(), pruned: 0 });
    assert_eq!(scratch.backup_names(), vec!["listulator-before-1.4.1-20231114-221320.sqlite"]);
    assert_eq!(std::fs::read_to_string(scratch.marker()).unwrap(), "1.4.1");
  }

  #[test]
  fn the_backup_opens_as_a_database_with_the_same_rows() {
    let scratch = Scratch::new("opens");
    make(&scratch.database(), 28, 3692);

    back_up_at(&scratch.0, "1.4.1", NOW);

    let copy = scratch.backups().join(&scratch.backup_names()[0]);
    assert_eq!(count(&copy, "lists"), 28);
    assert_eq!(count(&copy, "list_items"), 3692);
    assert_eq!(count(&scratch.database(), "list_items"), 3692, "the original is as it was");
  }

  #[test]
  fn the_backup_holds_rows_that_are_still_only_in_the_log() {
    let scratch = Scratch::new("in-the-log");
    make(&scratch.database(), 1, 10);
    // The running app's own connection: its writes sit in `-wal` until a checkpoint, and a plain copy of the main file would miss them.
    let app = tauri::async_runtime::block_on(async {
      let mut app = open(&scratch.database()).await;
      sqlx::query("INSERT INTO list_items (list_id, title) VALUES (1, 'Written a second ago')").execute(&mut app).await.unwrap();

      app
    });
    let log = scratch.0.join(format!("{DATABASE_FILE}-wal"));
    assert!(std::fs::metadata(&log).map(|m| m.len() > 0).unwrap_or(false), "the new row is in the log, not the file");

    back_up_at(&scratch.0, "1.4.1", NOW);

    tauri::async_runtime::block_on(async { app.close().await.unwrap() });
    let copy = scratch.backups().join(&scratch.backup_names()[0]);
    assert_eq!(count(&copy, "list_items"), 11);
  }

  #[test]
  fn the_same_version_makes_no_backup() {
    let scratch = Scratch::new("same");
    make(&scratch.database(), 3, 30);
    std::fs::write(scratch.marker(), "1.4.1").unwrap();

    assert_eq!(back_up_at(&scratch.0, "1.4.1", NOW), Outcome::Unchanged);

    assert!(!scratch.backups().exists());
  }

  #[test]
  fn a_marker_with_a_line_ending_still_names_its_version() {
    let scratch = Scratch::new("newline");
    make(&scratch.database(), 3, 30);
    std::fs::write(scratch.marker(), "1.4.1\n").unwrap();

    assert_eq!(back_up_at(&scratch.0, "1.4.1", NOW), Outcome::Unchanged);
  }

  #[test]
  fn a_changed_version_makes_exactly_one_backup_and_moves_the_marker() {
    let scratch = Scratch::new("changed");
    make(&scratch.database(), 3, 30);
    std::fs::write(scratch.marker(), "1.4.0").unwrap();

    let outcome = back_up_at(&scratch.0, "1.4.1", NOW);

    assert!(matches!(outcome, Outcome::BackedUp { .. }), "got {outcome:?}");
    assert_eq!(scratch.backup_names().len(), 1);
    assert_eq!(std::fs::read_to_string(scratch.marker()).unwrap(), "1.4.1");
    // The next start of the same build finds the marker level and does nothing.
    assert_eq!(back_up_at(&scratch.0, "1.4.1", NOW + 60), Outcome::Unchanged);
    assert_eq!(scratch.backup_names().len(), 1);
  }

  #[test]
  fn a_fourth_backup_removes_the_oldest() {
    let scratch = Scratch::new("fourth");
    make(&scratch.database(), 3, 30);

    for (index, version) in ["1.4.0", "1.4.1", "1.4.2", "1.4.3"].iter().enumerate() {
      let outcome = back_up_at(&scratch.0, version, NOW + index as u64 * DAY);
      if index == 3 {
        assert_eq!(outcome, Outcome::BackedUp { name: "listulator-before-1.4.3-20231117-221320.sqlite".to_string(), pruned: 1 });
      }
    }

    assert_eq!(
      scratch.backup_names(),
      vec![
        "listulator-before-1.4.1-20231115-221320.sqlite",
        "listulator-before-1.4.2-20231116-221320.sqlite",
        "listulator-before-1.4.3-20231117-221320.sqlite",
      ]
    );
  }

  #[test]
  fn the_newest_is_decided_by_the_date_not_by_the_version_text() {
    let scratch = Scratch::new("by-date");
    make(&scratch.database(), 3, 30);

    // "1.10.0" sorts before "1.9.0" as text, and is the newest.
    for (index, version) in ["1.8.0", "1.9.0", "1.10.0", "1.10.1"].iter().enumerate() {
      back_up_at(&scratch.0, version, NOW + index as u64 * DAY);
    }

    let names = scratch.backup_names();
    assert_eq!(names.len(), 3);
    assert!(names.iter().all(|name| !name.contains("1.8.0")), "the oldest went: {names:?}");
    assert!(names.iter().any(|name| name.contains("1.10.1")));
  }

  #[test]
  fn files_that_are_not_ours_are_never_counted_or_deleted() {
    let scratch = Scratch::new("foreign");
    make(&scratch.database(), 3, 30);
    std::fs::create_dir_all(scratch.backups()).unwrap();
    // What the folder holds on the owner's machines: copies made by hand in September, and their sidecars; and look-alikes.
    let foreign = [
      "duldulator-pre-0006-20260913-030108.sqlite",
      "listulator-pre-backfill-tags-20260918-164419.sqlite",
      "listulator-pre-backfill-tags-20260918-164419.sqlite-shm",
      "listulator-pre-backfill-tags-20260918-164419.sqlite-wal",
      "listulator-before-notes.txt",
      "listulator-before-1.0.0.sqlite",
      "listulator-before-1.0.0-2023.sqlite",
    ];
    for name in foreign {
      std::fs::write(scratch.backups().join(name), "kept").unwrap();
    }

    for (index, version) in ["1.4.0", "1.4.1", "1.4.2", "1.4.3", "1.4.4"].iter().enumerate() {
      back_up_at(&scratch.0, version, NOW + index as u64 * DAY);
    }

    let names = scratch.backup_names();
    for name in foreign {
      assert_eq!(std::fs::read_to_string(scratch.backups().join(name)).unwrap(), "kept", "{name} was touched");
    }
    assert_eq!(names.len(), foreign.len() + KEEP, "{names:?}");
  }

  #[test]
  fn a_copy_left_half_made_is_removed_and_never_counted() {
    let scratch = Scratch::new("partial");
    make(&scratch.database(), 3, 30);
    std::fs::create_dir_all(scratch.backups()).unwrap();
    let leftover = "listulator-before-1.4.0-20231101-000000.sqlite.partial";
    std::fs::write(scratch.backups().join(leftover), "half").unwrap();

    back_up_at(&scratch.0, "1.4.1", NOW);

    assert_eq!(scratch.backup_names(), vec!["listulator-before-1.4.1-20231114-221320.sqlite"]);
  }

  #[test]
  fn a_folder_that_cannot_be_made_skips_and_leaves_the_database_and_marker_alone() {
    let scratch = Scratch::new("no-folder");
    make(&scratch.database(), 3, 30);
    std::fs::write(scratch.marker(), "1.4.0").unwrap();
    let before = std::fs::read(scratch.database()).unwrap();
    // A file where the folder should be.
    std::fs::write(scratch.backups(), "in the way").unwrap();

    let outcome = back_up_at(&scratch.0, "1.4.1", NOW);

    assert!(matches!(outcome, Outcome::Skipped(_)), "got {outcome:?}");
    assert_eq!(std::fs::read(scratch.database()).unwrap(), before);
    assert_eq!(std::fs::read_to_string(scratch.marker()).unwrap(), "1.4.0", "the next start tries again");
  }

  #[test]
  fn a_file_that_is_not_a_database_skips_and_leaves_nothing_in_the_folder() {
    let scratch = Scratch::new("not-a-database");
    std::fs::write(scratch.database(), "this is not a database".repeat(1000)).unwrap();
    let before = std::fs::read(scratch.database()).unwrap();

    let outcome = back_up_at(&scratch.0, "1.4.1", NOW);

    assert!(matches!(outcome, Outcome::Skipped(_)), "got {outcome:?}");
    assert_eq!(std::fs::read(scratch.database()).unwrap(), before);
    assert!(scratch.backup_names().is_empty(), "no copy, and no half-made one: {:?}", scratch.backup_names());
    assert!(!scratch.marker().exists());
  }

  #[test]
  fn there_is_nothing_to_tell_before_a_first_copy() {
    let scratch = Scratch::new("info-none");
    assert_eq!(existing(&scratch.0), None, "no folder");

    std::fs::create_dir_all(scratch.backups()).unwrap();
    for name in ["listulator-pre-backfill-tags-20260918-164419.sqlite", "listulator-before-notes.txt", "listulator-before-1.4.0-20231101-000000.sqlite.partial"] {
      std::fs::write(scratch.backups().join(name), "not ours").unwrap();
    }
    assert_eq!(existing(&scratch.0), None, "a folder of other files, or of a copy half-made");
  }

  #[test]
  fn it_tells_the_folder_and_how_many_copies_of_ours_there_are() {
    let scratch = Scratch::new("info-some");
    make(&scratch.database(), 3, 30);
    back_up_at(&scratch.0, "1.4.0", NOW);
    back_up_at(&scratch.0, "1.4.1", NOW + DAY);
    std::fs::write(scratch.backups().join("listulator-pre-backfill-tags-20260918-164419.sqlite"), "by hand").unwrap();

    assert_eq!(existing(&scratch.0), Some(Info { folder: scratch.backups().to_string_lossy().into_owned(), count: 2 }));
  }

  #[test]
  fn telling_changes_nothing() {
    let scratch = Scratch::new("info-readonly");
    make(&scratch.database(), 3, 30);
    back_up_at(&scratch.0, "1.4.0", NOW);
    let before = scratch.backup_names();

    existing(&scratch.0);

    assert_eq!(scratch.backup_names(), before);
  }
}
