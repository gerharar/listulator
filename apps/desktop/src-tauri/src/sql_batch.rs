//! One transaction for a list of statements (Phase 53, task 53.1).
//!
//! The desktop database had no transaction: every statement the page sends through the SQL plugin is its own commit, on whichever
//! pooled connection is free, and the hook refuses `BEGIN`. So a Reset that stops half-way left half a list (23,000 of 30,000 items) and
//! nothing repaired it at the next start. This takes the WHOLE list of statements in one call and runs it on one connection between
//! `BEGIN IMMEDIATE` and `COMMIT`; if any statement fails, or the app dies, none of it happened. docs/DECISIONS.md, "53.0 spike done", has
//! the measurements and the reasons (it supersedes the Phase 28 entry "H-012 gets NO transaction": that was about a transaction spread over
//! several calls, which still cannot work).
//!
//! The connection is the SQL plugin's own pool (`tauri_plugin_sql::DbInstances`), so there is one set of connections to the file. A write
//! from anywhere else waits for this one (SQLite's busy timeout, 5 s on those connections); reads are never blocked (WAL).
//!
//! Values go in and come out exactly as the plugin's `execute` and `select` do (`bind`, `value_of`), so a statement means the same thing
//! through either; `tests::matches_the_sql_plugin_value_for_value` runs both and compares. Rows come back as arrays in column order, which
//! is what the page's Drizzle bridge makes of the plugin's objects (`Object.values`), without the plugin's collision of two columns
//! with one name.
//!
//! `foreign_keys_off` is for a migration that rebuilds a table (create, copy, drop, rename): with enforcement on, dropping the parent
//! deletes its children even when the check is deferred (measured, 53.0), and `PRAGMA foreign_keys` does nothing inside a transaction.
//! It runs on a connection of its own, opened with enforcement off and closed after, so no pooled connection ever has the setting
//! changed, whatever happens; `PRAGMA foreign_key_check` must find nothing before the commit.
//!
//! The page reaches it only through `isolation/hook.js`, which admits the exact shape `{ db, statements: [{ query, values? }],
//! foreignKeysOff? }` and the same caps (53.2), and refuses every statement the one-statement commands refuse. `lib.rs` registers it;
//! `tauriCapabilities.guard.test.ts` pins that list and `sqlBatchLimits.guard.test.ts` keeps the caps equal on both sides.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::error::BoxDynError;
use sqlx::sqlite::{SqliteArguments, SqliteRow};
use sqlx::{Arguments, ConnectOptions, Connection, Executor, Row, SqliteConnection, SqlitePool, Statement as _, TypeInfo, Value as _, ValueRef};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

/// What one call may hold. The hook (53.2) checks the same numbers before the call reaches here; these are the second lock on the same door.
pub struct Limits {
  /// Most statements in one call. A 50,000-item rewrite is about 200 (250 rows to a statement).
  pub statements: usize,
  /// Most bytes of text and values in one call (a close lower bound of the JSON that carried them). The server's body limit is the same
  /// 64 MiB; a 50,000-item Reset is 22 MB and a deleted list 30 MB.
  pub bytes: usize,
}

impl Limits {
  pub const DEFAULT: Limits = Limits { statements: 2_000, bytes: 64 * 1024 * 1024 };

  /// Refuses a call over either limit before anything is opened.
  fn check(&self, statements: &[Statement]) -> Result<(), BatchError> {
    if statements.len() > self.statements {
      return Err(BatchError::outside(format!("too many statements: {} (at most {})", statements.len(), self.statements)));
    }
    let bytes: usize = statements.iter().map(Statement::size).sum();
    if bytes > self.bytes {
      return Err(BatchError::outside(format!("call too large: about {bytes} bytes (at most {})", self.bytes)));
    }

    Ok(())
  }
}

/// One statement and the values for its `$1`, `$2`, ... (the shape of the plugin's `execute` and `select`).
#[derive(Deserialize)]
pub struct Statement {
  pub query: String,
  #[serde(default)]
  pub values: Vec<Value>,
}

impl Statement {
  fn size(&self) -> usize {
    self.query.len() + self.values.iter().map(size_of_value).sum::<usize>()
  }
}

fn size_of_value(value: &Value) -> usize {
  match value {
    Value::String(text) => text.len(),
    Value::Number(_) => 20,
    Value::Bool(_) => 5,
    Value::Null => 4,
    other => other.to_string().len(),
  }
}

/// What one statement gave back: its rows (a read, or a write with `RETURNING`) as arrays in column order, and how many rows it changed.
/// For a statement that returns rows the count is the number of rows returned.
#[derive(Serialize, Debug, PartialEq)]
pub struct StatementResult {
  pub rows: Vec<Vec<Value>>,
  #[serde(rename = "rowsAffected")]
  pub rows_affected: u64,
}

/// Why the call did nothing. `statement` is the place in the list of the one that failed, or `None` when the call was refused or the
/// transaction itself could not be opened, checked or committed.
#[derive(Serialize, Debug, PartialEq)]
pub struct BatchError {
  pub statement: Option<usize>,
  pub message: String,
}

impl BatchError {
  fn at(statement: usize, message: impl ToString) -> BatchError {
    BatchError { statement: Some(statement), message: message.to_string() }
  }

  fn outside(message: impl ToString) -> BatchError {
    BatchError { statement: None, message: message.to_string() }
  }
}

/// Runs `statements` in one transaction and gives each one's result, or changes nothing and says why.
pub async fn run(pool: &SqlitePool, statements: &[Statement], foreign_keys_off: bool, limits: &Limits) -> Result<Vec<StatementResult>, BatchError> {
  limits.check(statements)?;
  if statements.is_empty() {
    return Ok(Vec::new());
  }

  if foreign_keys_off {
    // A connection of its own, the pool's settings with enforcement off from the start, closed after: no pooled connection ever has the
    // setting changed, so there is nothing to put back, on success, on failure or when this future is dropped half-way (the connection
    // closes, and SQLite rolls its transaction back).
    let options = pool.connect_options();
    let mut connection = (*options).clone().foreign_keys(false).connect().await.map_err(BatchError::outside)?;
    let outcome = in_transaction(&mut connection, statements, true).await;
    let _ = connection.close().await;

    return outcome;
  }

  let mut connection = pool.acquire().await.map_err(BatchError::outside)?;
  let outcome = in_transaction(&mut connection, statements, false).await;
  if outcome.is_err() {
    // The rollback was asked for already; if it could not be done, this connection would go back to the pool still holding the write
    // lock. A connection that is closed instead gives the lock up, whatever state it was in (and a failed batch is rare enough to pay for it).
    connection.close_on_drop();
  }

  outcome
}

/// `BEGIN IMMEDIATE` (the write lock is taken now, not at the first write, so the call either has it or fails at once), each statement in
/// order, `COMMIT`. A failure rolls back EXPLICITLY, not by letting the transaction drop: the lock is let go before this returns, and
/// the error reaches the page with the connection already free for the next write.
async fn in_transaction(connection: &mut SqliteConnection, statements: &[Statement], check_foreign_keys: bool) -> Result<Vec<StatementResult>, BatchError> {
  let mut transaction = connection.begin_with("BEGIN IMMEDIATE").await.map_err(BatchError::outside)?;
  let mut results = Vec::with_capacity(statements.len());

  for (index, statement) in statements.iter().enumerate() {
    match run_statement(&mut transaction, statement).await {
      Ok(result) => results.push(result),
      Err(message) => {
        let _ = transaction.rollback().await;

        return Err(BatchError::at(index, message));
      }
    }
  }

  if check_foreign_keys {
    let violations = sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut *transaction).await;
    match violations {
      Ok(rows) if rows.is_empty() => {}
      Ok(rows) => {
        let _ = transaction.rollback().await;

        return Err(BatchError::outside(format!("foreign key check failed: {} rows point at nothing", rows.len())));
      }
      Err(error) => {
        let _ = transaction.rollback().await;

        return Err(BatchError::outside(error));
      }
    }
  }

  if let Err(error) = transaction.commit().await {
    // A commit that fails leaves SQLite's transaction open; end it, or the connection would go back to the pool holding the lock.
    let _ = sqlx::query("ROLLBACK").execute(&mut *connection).await;

    return Err(BatchError::outside(error));
  }

  Ok(results)
}

/// One statement: prepared first (a statement with columns is read for its rows, one without is executed for its count).
async fn run_statement(connection: &mut SqliteConnection, statement: &Statement) -> Result<StatementResult, String> {
  let returns_rows = {
    let prepared = connection.prepare(&statement.query).await.map_err(|error| error.to_string())?;

    !prepared.columns().is_empty()
  };
  let query = sqlx::query_with(&statement.query, arguments(&statement.values).map_err(|error| error.to_string())?);

  if returns_rows {
    let rows = query.fetch_all(&mut *connection).await.map_err(|error| error.to_string())?;
    let rows = rows.iter().map(row_of).collect::<Result<Vec<_>, _>>()?;
    let rows_affected = rows.len() as u64;

    Ok(StatementResult { rows, rows_affected })
  } else {
    let result = query.execute(&mut *connection).await.map_err(|error| error.to_string())?;

    Ok(StatementResult { rows: Vec::new(), rows_affected: result.rows_affected() })
  }
}

/// The values bound as the SQL plugin binds them (`tauri-plugin-sql` 2.4.1 `wrapper.rs`, `execute` and `select`): null as NULL, text as text,
/// every number as a float (a JavaScript number is one already, so nothing is lost; the column's affinity makes it an integer again),
/// anything else (true, false, an array, an object) as its JSON text.
fn arguments(values: &[Value]) -> Result<SqliteArguments<'static>, BoxDynError> {
  let mut arguments = SqliteArguments::default();
  for value in values {
    match value {
      Value::Null => arguments.add(None::<String>)?,
      Value::String(text) => arguments.add(text.clone())?,
      Value::Number(number) => arguments.add(number.as_f64().unwrap_or_default())?,
      other => arguments.add(other.to_string())?,
    }
  }

  Ok(arguments)
}

fn row_of(row: &SqliteRow) -> Result<Vec<Value>, String> {
  (0..row.columns().len()).map(|index| value_of(row, index)).collect()
}

/// One value as the plugin's `select` gives it (`tauri-plugin-sql` 2.4.1 `decode/sqlite.rs`): by the value's own storage class, and a
/// value that cannot be read as that type is null, not an error. sqlx names a stored value's type by its storage class (`sqlx-sqlite`
/// `value.rs`, `type_info_opt`); the declared type of a column only names a NULL, which is null before the type is asked. So the plugin's
/// other arms (`BOOLEAN`, `NUMERIC`, `DATE`, `TIME`, `DATETIME`) are never reached for a stored value, and are not repeated here:
/// a column declared `DATETIME` that holds text reads as that text, in the plugin and here (`matches_the_sql_plugin_value_for_value`).
fn value_of(row: &SqliteRow, index: usize) -> Result<Value, String> {
  let raw = row.try_get_raw(index).map_err(|error| error.to_string())?;
  if raw.is_null() {
    return Ok(Value::Null);
  }

  Ok(match raw.type_info().name() {
    "TEXT" => raw.to_owned().try_decode::<String>().map(Value::String).unwrap_or(Value::Null),
    "REAL" => raw.to_owned().try_decode::<f64>().map(Value::from).unwrap_or(Value::Null),
    "INTEGER" => raw.to_owned().try_decode::<i64>().map(|n| Value::Number(n.into())).unwrap_or(Value::Null),
    "BLOB" => raw
      .to_owned()
      .try_decode::<Vec<u8>>()
      .map(|bytes| Value::Array(bytes.into_iter().map(|byte| Value::Number(byte.into())).collect()))
      .unwrap_or(Value::Null),
    "NULL" => Value::Null,
    other => return Err(format!("unsupported datatype: {other}")),
  })
}

/// The command the page calls: the plugin's pool for `db`, then `run`.
#[tauri::command]
pub async fn sql_batch(
  instances: State<'_, DbInstances>,
  db: String,
  statements: Vec<Statement>,
  foreign_keys_off: Option<bool>,
) -> Result<Vec<StatementResult>, BatchError> {
  let pool = {
    let loaded = instances.0.read().await;
    match loaded.get(&db) {
      Some(DbPool::Sqlite(pool)) => pool.clone(),
      _ => return Err(BatchError::outside(format!("database not loaded: {db}"))),
    }
  };

  run(&pool, &statements, foreign_keys_off.unwrap_or(false), &Limits::DEFAULT).await
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;
  use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
  use std::path::{Path, PathBuf};
  use std::time::{Duration, Instant};

  /// A folder of its own for one test, removed after.
  struct Scratch(PathBuf);

  impl Scratch {
    fn new(name: &str) -> Scratch {
      let path = std::env::temp_dir().join(format!("listulator-sql-batch-{name}-{}", std::process::id()));
      let _ = std::fs::remove_dir_all(&path);
      std::fs::create_dir_all(&path).unwrap();
      Scratch(path)
    }

    fn file(&self) -> PathBuf {
      self.0.join("listulator.sqlite")
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }

  fn block<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
  }

  /// A pool like the app's: the file in WAL, foreign keys on (sqlx's default), 5 s of patience for the write lock.
  async fn open(path: &Path) -> SqlitePool {
    let options = SqliteConnectOptions::new().filename(path).create_if_missing(true).journal_mode(SqliteJournalMode::Wal);
    SqlitePoolOptions::new().max_connections(4).connect_with(options).await.unwrap()
  }

  fn sql(query: &str, values: Vec<Value>) -> Statement {
    Statement { query: query.to_string(), values }
  }

  /// The two tables most tests use: a parent and children that go with it.
  async fn fixture(pool: &SqlitePool) {
    for query in [
      "CREATE TABLE lists (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL)",
      "CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL, list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE, n INTEGER)",
    ] {
      sqlx::query(query).execute(pool).await.unwrap();
    }
  }

  async fn count(pool: &SqlitePool, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT count(*) FROM {table}")).fetch_one(pool).await.unwrap()
  }

  #[test]
  fn runs_every_statement_in_order_and_returns_what_each_gave() {
    let scratch = Scratch::new("order");
    block(async {
      let pool = open(&scratch.file()).await;
      fixture(&pool).await;
      let results = run(
        &pool,
        &[
          sql("INSERT INTO lists (id, title) VALUES ($1, $2)", vec![json!("l1"), json!("One")]),
          sql("INSERT INTO items (id, list_id, n) VALUES ($1, $2, 1), ($3, $2, 2)", vec![json!("a"), json!("l1"), json!("b")]),
          sql("SELECT id, n FROM items ORDER BY n", vec![]),
          sql("UPDATE items SET n = n + 10 WHERE list_id = $1", vec![json!("l1")]),
        ],
        false,
        &Limits::DEFAULT,
      )
      .await
      .unwrap();

      assert_eq!(results.len(), 4);
      assert_eq!((results[0].rows.len(), results[0].rows_affected), (0, 1));
      assert_eq!((results[1].rows.len(), results[1].rows_affected), (0, 2));
      assert_eq!(results[2].rows, vec![vec![json!("a"), json!(1)], vec![json!("b"), json!(2)]]);
      assert_eq!(results[3].rows_affected, 2);
      assert_eq!(count(&pool, "items").await, 2);
    });
  }

  #[test]
  fn a_failure_at_statement_k_leaves_the_database_as_it_was_and_names_k() {
    let scratch = Scratch::new("rollback");
    block(async {
      let pool = open(&scratch.file()).await;
      fixture(&pool).await;
      sqlx::query("INSERT INTO lists VALUES ('keep', 'Kept')").execute(&pool).await.unwrap();

      let error = run(
        &pool,
        &[
          sql("DELETE FROM lists", vec![]),
          sql("INSERT INTO lists (id, title) VALUES ('new', 'New')", vec![]),
          sql("INSERT INTO lists (id, title) VALUES ('bad', NULL)", vec![]),
          sql("INSERT INTO lists (id, title) VALUES ('never', 'Never')", vec![]),
        ],
        false,
        &Limits::DEFAULT,
      )
      .await
      .unwrap_err();

      assert_eq!(error.statement, Some(2));
      assert!(error.message.contains("NOT NULL"), "{}", error.message);
      let titles: Vec<String> = sqlx::query_scalar("SELECT title FROM lists ORDER BY id").fetch_all(&pool).await.unwrap();
      assert_eq!(titles, vec!["Kept"], "the delete and the insert before the failure must be gone");

      // The lock went with the rollback: another connection writes at once instead of waiting out the 5 s of patience.
      let started = Instant::now();
      sqlx::query("INSERT INTO lists VALUES ('after', 'After')").execute(&pool).await.unwrap();
      assert!(started.elapsed() < Duration::from_secs(1), "the write waited {:?} for a lock the failed batch should have let go", started.elapsed());
    });
  }

  #[test]
  fn a_statement_that_cannot_be_prepared_fails_the_call_the_same_way() {
    let scratch = Scratch::new("prepare");
    block(async {
      let pool = open(&scratch.file()).await;
      fixture(&pool).await;
      let error = run(
        &pool,
        &[sql("INSERT INTO lists VALUES ('x', 'X')", vec![]), sql("INSERT INTO nope VALUES (1)", vec![])],
        false,
        &Limits::DEFAULT,
      )
      .await
      .unwrap_err();

      assert_eq!(error.statement, Some(1));
      assert!(error.message.contains("no such table: nope"), "{}", error.message);
      assert_eq!(count(&pool, "lists").await, 0);
    });
  }

  #[test]
  fn returning_rows_come_back_for_the_statement_that_made_them() {
    let scratch = Scratch::new("returning");
    block(async {
      let pool = open(&scratch.file()).await;
      fixture(&pool).await;
      let results = run(
        &pool,
        &[
          sql("INSERT INTO lists VALUES ('l', 'L')", vec![]),
          sql("INSERT INTO items (id, list_id, n) VALUES ('a', 'l', 5), ('b', 'l', 6) RETURNING id, n", vec![]),
          sql("DELETE FROM items WHERE id = $1 RETURNING id", vec![json!("a")]),
        ],
        false,
        &Limits::DEFAULT,
      )
      .await
      .unwrap();

      assert_eq!(results[1].rows, vec![vec![json!("a"), json!(5)], vec![json!("b"), json!(6)]]);
      assert_eq!(results[1].rows_affected, 2);
      assert_eq!(results[2].rows, vec![vec![json!("a")]]);
    });
  }

  #[test]
  fn refuses_a_call_over_either_limit_before_running_anything() {
    let scratch = Scratch::new("limits");
    block(async {
      let pool = open(&scratch.file()).await;
      fixture(&pool).await;
      let small = Limits { statements: 3, bytes: 200 };
      let insert = || sql("INSERT INTO lists VALUES ('x', 'X')", vec![]);

      let many = run(&pool, &[insert(), insert(), insert(), insert()], false, &small).await.unwrap_err();
      assert_eq!(many.statement, None);
      assert!(many.message.contains("too many statements: 4 (at most 3)"), "{}", many.message);

      let big = run(&pool, &[sql("INSERT INTO lists VALUES ('x', $1)", vec![json!("y".repeat(300))])], false, &small).await.unwrap_err();
      assert_eq!(big.statement, None);
      assert!(big.message.contains("call too large"), "{}", big.message);

      assert_eq!(count(&pool, "lists").await, 0, "a refused call runs nothing");
      run(&pool, &[insert()], false, &small).await.unwrap();
    });
  }

  /// A parent rebuilt the way SQLite's own instructions say: a new table, the rows copied, the old one dropped, the new one renamed.
  fn rebuild_lists() -> Vec<Statement> {
    vec![
      sql("CREATE TABLE lists_new (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, extra TEXT)", vec![]),
      sql("INSERT INTO lists_new (id, title) SELECT id, title FROM lists", vec![]),
      sql("DROP TABLE lists", vec![]),
      sql("ALTER TABLE lists_new RENAME TO lists", vec![]),
    ]
  }

  async fn parent_with_two_children(pool: &SqlitePool) {
    fixture(pool).await;
    for query in ["INSERT INTO lists VALUES ('l1', 'One')", "INSERT INTO items VALUES ('a', 'l1', 1), ('b', 'l1', 2)"] {
      sqlx::query(query).execute(pool).await.unwrap();
    }
  }

  #[test]
  fn a_rebuild_keeps_the_children_only_with_foreign_keys_off() {
    let scratch = Scratch::new("rebuild");
    block(async {
      let pool = open(&scratch.file()).await;
      parent_with_two_children(&pool).await;

      // The hazard the option exists for (measured in 53.0): with enforcement on, dropping the parent deletes its children.
      let lost = Scratch::new("rebuild-on");
      let on = open(&lost.file()).await;
      parent_with_two_children(&on).await;
      run(&on, &rebuild_lists(), false, &Limits::DEFAULT).await.unwrap();
      assert_eq!(count(&on, "items").await, 0, "the children went with the dropped parent");

      run(&pool, &rebuild_lists(), true, &Limits::DEFAULT).await.unwrap();
      assert_eq!(count(&pool, "items").await, 2, "the children stayed");
      let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('lists') ORDER BY cid").fetch_all(&pool).await.unwrap();
      assert_eq!(columns, vec!["id", "title", "extra"], "and the parent is the new table");
    });
  }

  #[test]
  fn foreign_keys_off_refuses_to_commit_a_child_left_with_no_parent() {
    let scratch = Scratch::new("check");
    block(async {
      let pool = open(&scratch.file()).await;
      parent_with_two_children(&pool).await;

      let error = run(&pool, &[sql("DELETE FROM lists WHERE id = 'l1'", vec![])], true, &Limits::DEFAULT).await.unwrap_err();

      assert_eq!(error.statement, None);
      assert!(error.message.contains("foreign key check failed"), "{}", error.message);
      assert_eq!(count(&pool, "lists").await, 1, "rolled back: the parent is still there");
      assert_eq!(count(&pool, "items").await, 2);
    });
  }

  #[test]
  fn a_failing_foreign_keys_off_batch_leaves_every_pooled_connection_enforcing_and_the_lock_free() {
    let scratch = Scratch::new("restore");
    block(async {
      let pool = open(&scratch.file()).await;
      parent_with_two_children(&pool).await;

      let mut broken = rebuild_lists();
      broken.insert(3, sql("INSERT INTO nope VALUES (1)", vec![]));
      let error = run(&pool, &broken, true, &Limits::DEFAULT).await.unwrap_err();
      assert_eq!(error.statement, Some(3));
      run(&pool, &rebuild_lists(), true, &Limits::DEFAULT).await.unwrap();

      // Three connections at the same moment, so they are three different ones: each still enforces.
      let mut held = Vec::new();
      for _ in 0..3 {
        held.push(pool.acquire().await.unwrap());
      }
      for connection in held.iter_mut() {
        let enforcing: i64 = sqlx::query_scalar("PRAGMA foreign_keys").fetch_one(&mut **connection).await.unwrap();
        assert_eq!(enforcing, 1);
      }
      drop(held);

      let started = Instant::now();
      sqlx::query("INSERT INTO items VALUES ('c', 'l1', 3)").execute(&pool).await.unwrap();
      assert!(started.elapsed() < Duration::from_secs(1), "the write waited {:?} for the lock", started.elapsed());
      assert!(sqlx::query("INSERT INTO items VALUES ('d', 'nobody', 4)").execute(&pool).await.is_err(), "a pooled connection still refuses a child with no parent");
    });
  }

  /// The tests that run the SQL plugin's own commands next to `sql_batch` in a mock app (53.1). Not built on Windows: building an app, even a
  /// mock one, pulls in the menu code (`muda`), which imports `SetWindowSubclass` from `comctl32.dll` by name, and that name exists only in
  /// version 6, which a program gets from a manifest. `tauri-build` puts one in the app's own binary and not in the library's test program, so
  /// there the program stopped at start (`STATUS_ENTRYPOINT_NOT_FOUND`, found by the first CI run of `phase-53`, 2026-11-16) and no test ran at
  /// all. What these tests compare (what binds, what comes back, the command's name over IPC) does not depend on the system; the other tests of
  /// this file, which do not build an app, run on Windows too.
  #[cfg(not(windows))]
  mod through_the_app {
    use super::*;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::MockRuntime;
    use tauri::webview::InvokeRequest;
    use tauri::{Manager, WebviewWindow};

    const DB: &str = "sqlite:listulator.sqlite";

    /// An app with the real SQL plugin and `sql_batch`, both on `pool`, built from the app's own configuration (its capability file is what
    /// lets the plugin's commands through; a bare mock context refuses them) (the plugin's `DbInstances` is filled by hand: its `load` would make a
    /// folder under the user's config directory).
    fn mock_app(pool: SqlitePool) -> (tauri::App<MockRuntime>, WebviewWindow<MockRuntime>) {
      let instances = DbInstances::default();
      block(async { instances.0.write().await.insert(DB.to_string(), DbPool::Sqlite(pool)) });
      let app = tauri::test::mock_builder()
        .manage(instances)
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![sql_batch])
        .build(crate::app_context::<MockRuntime>())
        .unwrap();
      let webview = app
        .get_webview_window("main")
        .unwrap_or_else(|| tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap());

      (app, webview)
    }

    fn invoke(webview: &WebviewWindow<MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
      let url = if cfg!(any(windows, target_os = "android")) { "http://tauri.localhost" } else { "tauri://localhost" };
      let request = InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: url.parse().unwrap(),
        body: InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.to_string(),
      };

      tauri::test::get_ipc_response(webview, request).map(|response| response.deserialize::<Value>().unwrap())
    }

    /// The plugin's `execute`, and its `select` as the page reads it (an object per row; the column names here are one letter, in order).
    fn plugin_execute(webview: &WebviewWindow<MockRuntime>, query: &str, values: &[Value]) -> Result<Value, Value> {
      invoke(webview, "plugin:sql|execute", json!({ "db": DB, "query": query, "values": values }))
    }

    fn plugin_select(webview: &WebviewWindow<MockRuntime>, query: &str, values: &[Value]) -> Result<Vec<Vec<Value>>, Value> {
      let rows = invoke(webview, "plugin:sql|select", json!({ "db": DB, "query": query, "values": values }))?;

      Ok(rows.as_array().unwrap().iter().map(|row| row.as_object().unwrap().values().cloned().collect()).collect())
    }

    fn batch_one(webview: &WebviewWindow<MockRuntime>, query: &str, values: &[Value]) -> Result<Vec<Vec<Value>>, Value> {
      let results = invoke(webview, "sql_batch", json!({ "db": DB, "statements": [{ "query": query, "values": values }] }))?;

      Ok(results[0]["rows"].as_array().unwrap().iter().map(|row| row.as_array().unwrap().clone()).collect())
    }

    #[test]
    fn matches_the_sql_plugin_value_for_value() {
      let scratch = Scratch::new("parity");
      let pool = block(open(&scratch.file()));
      let (_app, webview) = mock_app(pool);

      // Every declared type the app's tables use (`integer`, `text`; Drizzle writes nothing else) and the others SQLite and the plugin know,
      // each with every kind of value a page can send. The row goes in once through the plugin and once through `sql_batch`; what lands in
      // the table must be the same (binding), and each way of reading the two rows must give the same values (decoding).
      let declared = ["INTEGER", "REAL", "TEXT", "BLOB", "BOOLEAN", "NUMERIC", ""];
      let bound = [
        json!(null), json!(0), json!(7), json!(-3), json!(1.5), json!(1e300), json!(9007199254740992_i64), json!("x'y"), json!(""), json!("7"),
        json!(true), json!(false), json!([1, 2]), json!({ "a": 1 }),
      ];
      let mut compared = 0;
      for (table, (kind, value)) in declared.iter().flat_map(|kind| bound.iter().map(move |value| (kind, value))).enumerate() {
        plugin_execute(&webview, &format!("CREATE TABLE t{table} (a {kind})"), &[]).unwrap();
        let insert = format!("INSERT INTO t{table} (a) VALUES ($1)");
        plugin_execute(&webview, &insert, std::slice::from_ref(value)).unwrap();
        batch_one(&webview, &insert, std::slice::from_ref(value)).unwrap();

        let read = format!("SELECT a FROM t{table} ORDER BY rowid");
        let by_plugin = plugin_select(&webview, &read, &[]);
        let by_batch = batch_one(&webview, &read, &[]);
        let what = format!("declared {kind:?}, bound {value}");
        assert_eq!(by_plugin.is_ok(), by_batch.is_ok(), "{what}: one reads it, the other refuses: {by_plugin:?} / {by_batch:?}");
        if let (Ok(by_plugin), Ok(by_batch)) = (by_plugin, by_batch) {
          assert_eq!(by_plugin.len(), 2, "{what}");
          assert_eq!(by_plugin[0], by_plugin[1], "{what}: the two ways of binding stored different things");
          assert_eq!(by_batch, by_plugin, "{what}: the two ways of reading gave different values");
          compared += 1;
        }
      }
      assert_eq!(compared, declared.len() * bound.len(), "a case where both sides refused was not compared");

      // A real blob (no way to send one as a JSON value, so it is in the SQL text) and values with no declared type: expressions.
      plugin_execute(&webview, "CREATE TABLE blobs (a BLOB)", &[]).unwrap();
      plugin_execute(&webview, "INSERT INTO blobs VALUES (x'00ff10')", &[]).unwrap();
      for query in [
        "SELECT a FROM blobs",
        "SELECT 1 AS a, 1.5 AS b, 'x' AS c, NULL AS d, x'01' AS e, 2 > 1 AS f, length('abc') AS g, 7.0 AS h, -0.0 AS i",
        "INSERT INTO blobs VALUES (x'0a') RETURNING a",
        "SELECT 1 WHERE 0",
      ] {
        assert_eq!(batch_one(&webview, query, &[]), plugin_select(&webview, query, &[]), "{query}");
      }
    }

    #[test]
    fn the_command_answers_over_ipc_in_the_shape_the_bridge_reads() {
      let scratch = Scratch::new("ipc");
      let pool = block(open(&scratch.file()));
      block(fixture(&pool));
      let (_app, webview) = mock_app(pool);

      let ok = invoke(
        &webview,
        "sql_batch",
        json!({ "db": DB, "statements": [
          { "query": "INSERT INTO lists VALUES ($1, 'L') RETURNING id", "values": ["l1"] },
          { "query": "SELECT count(*) FROM lists" },
        ] }),
      );
      assert_eq!(ok, Ok(json!([{ "rows": [["l1"]], "rowsAffected": 1 }, { "rows": [[1]], "rowsAffected": 1 }])));

      let failed = invoke(&webview, "sql_batch", json!({ "db": DB, "statements": [{ "query": "DELETE FROM lists" }, { "query": "INSERT INTO nope VALUES (1)" }] }));
      assert_eq!(failed.as_ref().unwrap_err()["statement"], json!(1));
      assert!(failed.unwrap_err()["message"].as_str().unwrap().contains("no such table: nope"));
      assert_eq!(plugin_select(&webview, "SELECT count(*) FROM lists", &[]), Ok(vec![vec![json!(1)]]), "the delete before the failure was undone");

      let not_loaded = invoke(&webview, "sql_batch", json!({ "db": "sqlite:other.sqlite", "statements": [{ "query": "SELECT 1" }] }));
      assert_eq!(not_loaded.as_ref().unwrap_err()["statement"], json!(null));
      assert!(not_loaded.unwrap_err()["message"].as_str().unwrap().contains("database not loaded"));
    }

    #[test]
    fn the_foreign_keys_option_is_honoured_over_ipc_under_its_camel_case_name() {
      let scratch = Scratch::new("ipc-fk");
      let pool = block(open(&scratch.file()));
      block(parent_with_two_children(&pool));
      let (_app, webview) = mock_app(pool);
      let rebuild: Vec<Value> = rebuild_lists().iter().map(|s| json!({ "query": s.query })).collect();

      let done = invoke(&webview, "sql_batch", json!({ "db": DB, "statements": rebuild, "foreignKeysOff": true }));

      assert!(done.is_ok(), "{done:?}");
      assert_eq!(plugin_select(&webview, "SELECT count(*) FROM items", &[]), Ok(vec![vec![json!(2)]]), "the children stayed");
    }

  }

  #[test]
  fn an_empty_call_is_nothing_to_do() {
    let scratch = Scratch::new("empty");
    block(async {
      let pool = open(&scratch.file()).await;
      assert_eq!(run(&pool, &[], false, &Limits::DEFAULT).await.unwrap(), vec![]);
    });
  }
}
