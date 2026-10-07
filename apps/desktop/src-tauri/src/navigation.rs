//! Where the app's window may go (security review, Phase 19, SR-015).
//!
//! The window holds the key store, the library database and the HTTP plugin, and Tauri lets it navigate to any address
//! unless a hook says no: a script that ran in the app could send data out with `location.href = 'https://…?d=…'` and
//! the window would show the other site in the app's own frame (probe P6). The app itself never navigates anywhere:
//! it loads its own page, reloads it, and opens links in the system browser through the opener plugin. So this hook
//! refuses every address that is not the app's own origin.

use tauri::Url;

/// What the packaged app is served from: `tauri://localhost` on macOS and Linux, `http://tauri.localhost` on Windows
/// (no `useHttpsScheme` in `tauri.conf.json`). Port-less: a different port is a different server.
const APP_ORIGINS: [(&str, &str); 2] = [("tauri", "localhost"), ("http", "tauri.localhost")];

/// The Vite dev server, `tauri dev` only (`tauri::is_dev()`: the `custom-protocol` feature that `tauri build` turns on, debug or
/// not, is what makes an app load its packaged page).
const DEV_ORIGIN: (&str, &str, u16) = ("http", "localhost", 5173);

/// A navigation hook for the window: `true` lets it through. A refusal logs the host only, never the address, which is
/// where a script would put what it is sending out.
pub fn guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
  tauri::plugin::Builder::new("navigation-guard")
    .on_navigation(|_webview, url| {
      let allowed = allowed(url, tauri::is_dev());
      if !allowed {
        log::warn!("refused navigation to {}://{}", url.scheme(), url.host_str().unwrap_or(""));
      }
      allowed
    })
    .build()
}

/// Whether the window may load `url`. `dev` allows the development server's origin: true under `tauri dev` only.
pub fn allowed(url: &Url, dev: bool) -> bool {
  // A blob address is made by our own page (an export download) and carries that page's origin after the scheme:
  // `blob:tauri://localhost/<uuid>`. It is as safe as the origin inside it, and a blob inside a blob is not allowed.
  if url.scheme() == "blob" {
    return Url::parse(url.path()).is_ok_and(|inner| inner.scheme() != "blob" && allowed(&inner, dev));
  }
  // `http://tauri.localhost@evil.example` has the host `evil.example`; a password or name has no place in the app's own
  // address at all.
  if !url.username().is_empty() || url.password().is_some() {
    return false;
  }
  let host = url.host_str().unwrap_or("");
  if url.port().is_none() && APP_ORIGINS.iter().any(|(scheme, app_host)| url.scheme() == *scheme && host == *app_host) {
    return true;
  }
  dev && url.scheme() == DEV_ORIGIN.0 && host == DEV_ORIGIN.1 && url.port() == Some(DEV_ORIGIN.2)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn url(text: &str) -> Url {
    Url::parse(text).unwrap_or_else(|error| panic!("fixture {text:?} does not parse: {error}"))
  }

  #[test]
  fn lets_the_app_load_and_reload_its_own_page() {
    for text in [
      "tauri://localhost",
      "tauri://localhost/",
      "tauri://localhost/index.html",
      "tauri://localhost/?x=1#/list/abc",
      "http://tauri.localhost",
      "http://tauri.localhost/",
      "http://tauri.localhost/index.html?x=1#y",
    ] {
      assert!(allowed(&url(text), false), "{text} must be allowed");
    }
  }

  #[test]
  fn lets_an_export_download_through_when_the_page_made_it() {
    for text in ["blob:tauri://localhost/5a1b2c3d-0000-4000-8000-000000000000", "blob:http://tauri.localhost/5a1b2c3d"] {
      assert!(allowed(&url(text), false), "{text} must be allowed");
    }
  }

  #[test]
  fn refuses_other_sites() {
    for text in [
      "https://example.com/?sr19=1",
      "http://example.com/",
      "https://raw.githubusercontent.com/gerharar/listulator/main/lists/index.json",
      "https://api.themoviedb.org/3/search/movie",
      "https://github.com/gerharar/listulator",
    ] {
      assert!(!allowed(&url(text), false), "{text} must be refused");
      assert!(!allowed(&url(text), true), "{text} must be refused under `tauri dev` too");
    }
  }

  #[test]
  fn refuses_addresses_that_only_look_like_the_apps_own() {
    for text in [
      "http://tauri.localhost.evil.example/",
      "http://evil.example/tauri.localhost",
      "http://evil.example/?next=http://tauri.localhost/",
      "http://tauri.localhost@evil.example/",
      "http://tauri.localhost:pw@evil.example/",
      "http://user@tauri.localhost/",
      "http://user:pw@tauri.localhost/",
      "tauri://localhost.evil.example/",
      "tauri://localhost@evil.example/",
      "tauri://evil.example/",
      "tauri://user@localhost/",
      "http://tauri.localhost:8080/",
      "tauri://localhost:1234/",
      "https://tauri.localhost/",
      "http://localhost/",
      "http://evil.tauri.localhost/",
    ] {
      assert!(!allowed(&url(text), false), "{text} must be refused");
      assert!(!allowed(&url(text), true), "{text} must be refused under `tauri dev` too");
    }
  }

  #[test]
  fn refuses_schemes_that_read_files_or_run_script() {
    for text in [
      "file:///etc/passwd",
      "file://localhost/etc/passwd",
      "data:text/html,<script>1</script>",
      "javascript:alert(1)",
      "about:blank",
      "ftp://example.com/",
      "ws://example.com/",
      "ipc://localhost/plugin:store|load",
      "asset://localhost/etc/passwd",
      "view-source:https://example.com/",
    ] {
      assert!(!allowed(&url(text), false), "{text} must be refused");
      assert!(!allowed(&url(text), true), "{text} must be refused under `tauri dev` too");
    }
  }

  #[test]
  fn refuses_a_blob_from_anywhere_else_or_nested() {
    for text in [
      "blob:https://example.com/5a1b2c3d",
      "blob:http://tauri.localhost@evil.example/5a1b2c3d",
      "blob:blob:tauri://localhost/5a1b2c3d",
      "blob:file:///etc/passwd",
      "blob:null/5a1b2c3d",
      "blob:",
    ] {
      assert!(!allowed(&url(text), false), "{text} must be refused");
    }
  }

  #[test]
  fn lets_the_dev_server_in_only_under_tauri_dev_and_only_at_its_port() {
    assert!(allowed(&url("http://localhost:5173/"), true));
    assert!(allowed(&url("http://localhost:5173/?aboutUpdate=fail#x"), true));
    assert!(!allowed(&url("http://localhost:5173/"), false), "a packaged build has no dev server");
    for text in [
      "http://localhost:5174/",
      "http://localhost/",
      "http://localhost.evil.example:5173/",
      "https://localhost:5173/",
      "http://127.0.0.1:5173/",
      "http://[::1]:5173/",
      "http://localhost:5173@evil.example/",
      "http://user@localhost:5173/",
    ] {
      assert!(!allowed(&url(text), true), "{text} must be refused even under `tauri dev`");
    }
  }
}
