//! What the page's Content-Security-Policy must say for the isolation frame to load (security review, 19.12.3; found broken in a
//! built app, DECISIONS "CORRECTION: the isolation hook ... only ever run under `tauri dev`").
//!
//! Tauri serves the isolation page from a scheme it names `isolation-<random id>`, a new id for every compile, so the page's
//! `frame-src` cannot be written in `tauri.conf.json`: it is added here, at start-up, from the name this very build holds. Without
//! it the page's `default-src 'self'` refuses the frame ("Refused to load isolation-…://localhost/ because it does not appear in
//! the frame-src directive"), nothing can reach the native side and the app stays on "Loading…". Under `tauri dev` the page comes
//! from the dev server and the CSP is not applied to it, which is why every check before the first built app missed this.

use tauri::utils::config::{Csp, CspDirectiveSources};

#[cfg(test)]
use std::collections::HashMap;

/// The CSP source that matches the isolation frame's address: `http://<scheme>.localhost` on Windows and Android, where a custom
/// scheme is served as a host of `localhost`, and `<scheme>:` elsewhere. The same rule as Tauri's own for the frame's CSP.
pub fn frame_source(scheme: &str, windows_like: bool) -> String {
  if windows_like {
    format!("http://{scheme}.localhost")
  } else {
    format!("{scheme}:")
  }
}

/// `csp` with `source` added to its `frame-src`. No policy stays no policy (nothing is enforced, so nothing needs allowing).
pub fn allow_frame(csp: Option<Csp>, source: &str) -> Option<Csp> {
  match csp? {
    Csp::Policy(text) => {
      if text.split(|c: char| c == ';' || c.is_whitespace()).any(|part| part == source) {
        Some(Csp::Policy(text))
      } else {
        Some(Csp::Policy(format!("{text}; frame-src {source}")))
      }
    }
    Csp::DirectiveMap(mut directives) => {
      let mut sources: Vec<String> = match directives.remove("frame-src") {
        Some(CspDirectiveSources::List(list)) => list,
        Some(CspDirectiveSources::Inline(text)) => text.split_whitespace().map(String::from).collect(),
        None => Vec::new(),
      };
      if !sources.iter().any(|existing| existing == source) {
        sources.push(source.to_string());
      }
      directives.insert("frame-src".to_string(), CspDirectiveSources::List(sources));

      Some(Csp::DirectiveMap(directives))
    }
  }
}

/// Adds the frame source for this build's isolation scheme to the context's CSP, and returns the scheme (for the navigation guard);
/// a context without the isolation pattern is left as it is and gives `None`.
pub fn allow_isolation_frame<R: tauri::Runtime>(context: &mut tauri::Context<R>) -> Option<String> {
  let scheme = match context.pattern() {
    tauri::Pattern::Isolation { schema, .. } => schema.clone(),
    _ => return None,
  };
  let source = frame_source(&scheme, cfg!(any(windows, target_os = "android")));
  let security = &mut context.config_mut().app.security;
  security.csp = allow_frame(security.csp.take(), &source);

  Some(scheme)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn map(entries: &[(&str, &str)]) -> Csp {
    Csp::DirectiveMap(entries.iter().map(|(name, value)| (name.to_string(), CspDirectiveSources::Inline(value.to_string()))).collect())
  }

  fn sources(csp: &Option<Csp>, directive: &str) -> Vec<String> {
    match csp {
      Some(Csp::DirectiveMap(map)) => match map.get(directive) {
        Some(CspDirectiveSources::List(list)) => list.clone(),
        Some(CspDirectiveSources::Inline(text)) => text.split_whitespace().map(String::from).collect(),
        None => vec![],
      },
      _ => vec![],
    }
  }

  #[test]
  fn names_the_frame_the_way_each_platform_serves_it() {
    assert_eq!(frame_source("isolation-1429cb57-24fe", false), "isolation-1429cb57-24fe:");
    assert_eq!(frame_source("isolation-1429cb57-24fe", true), "http://isolation-1429cb57-24fe.localhost");
  }

  #[test]
  fn adds_a_frame_src_where_there_is_none() {
    let csp = allow_frame(Some(map(&[("default-src", "'self'")])), "isolation-abc:");

    assert_eq!(sources(&csp, "frame-src"), vec!["isolation-abc:"]);
    assert_eq!(sources(&csp, "default-src"), vec!["'self'"], "the other directives are untouched");
  }

  #[test]
  fn adds_to_a_frame_src_that_is_there_without_dropping_it() {
    let csp = allow_frame(Some(map(&[("frame-src", "'none'")])), "http://isolation-abc.localhost");

    assert_eq!(sources(&csp, "frame-src"), vec!["'none'", "http://isolation-abc.localhost"]);
  }

  #[test]
  fn adds_to_a_list_of_sources_too() {
    let mut directives = HashMap::new();
    directives.insert("frame-src".to_string(), CspDirectiveSources::List(vec!["https://a.example".to_string()]));

    assert_eq!(sources(&allow_frame(Some(Csp::DirectiveMap(directives)), "isolation-abc:"), "frame-src"), vec!["https://a.example", "isolation-abc:"]);
  }

  #[test]
  fn does_not_list_the_source_twice() {
    let once = allow_frame(Some(map(&[("default-src", "'self'")])), "isolation-abc:");

    assert_eq!(sources(&allow_frame(once, "isolation-abc:"), "frame-src"), vec!["isolation-abc:"]);
  }

  #[test]
  fn appends_to_a_policy_written_as_text() {
    match allow_frame(Some(Csp::Policy("default-src 'self'".to_string())), "isolation-abc:") {
      Some(Csp::Policy(text)) => assert_eq!(text, "default-src 'self'; frame-src isolation-abc:"),
      other => panic!("expected a policy text, got {other:?}"),
    }
  }

  #[test]
  fn leaves_no_policy_as_no_policy() {
    assert!(allow_frame(None, "isolation-abc:").is_none());
  }
}
