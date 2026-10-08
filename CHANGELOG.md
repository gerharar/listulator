# Changelog

What changed in each version of Listulator, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers
follow [Semantic Versioning](https://semver.org/).

## [1.0.0] — Unreleased

The first release. The date is filled in when it is published.

### Added

- Lists you work through to 100%: tick items done, group them, reorder them by
  hand or sort them by year, and see each list's progress at a glance.
- Twelve categories with search: Movies, TV Shows, Animation and Documentaries
  (TMDB), Wrestling and MMA (Wikipedia), Games (IGDB), Comics (Comic Vine),
  Books (Open Library), Music (MusicBrainz), YouTube (YouTube Data API), and
  Mega, a curated library of cross-media franchise lists.
- Lists typed in by hand, or imported from a file, in any category.
- Three suggestion buttons for when you don't know what to pick up next.
- Checking a list for new items, with deleted items staying deleted.
- A filter bar on every list: text, the category's own filters (Platform,
  Type, Language), and Hide Completed, which each list remembers.
- A desktop app for Windows and macOS that keeps your library on your own
  computer, with full screen and a Quit / Exit button.
- English, Russian and German, and a choice of skins.
- YouTube playlists and channels carry each video's publish year, so they can be sorted by year.
- Installers for Windows (64-bit) and macOS (Apple silicon, macOS 11 or newer), built by GitHub Actions from a version
  tag, each published with a SHA-256 checksum file and a signed build attestation, so a download can be checked.

### Known limits

- The installers are not code-signed or notarized: Windows SmartScreen and your browser may warn, and macOS asks you to
  allow the app in Privacy & Security the first time. The README says how.
- Macs with an Intel processor are not supported.
