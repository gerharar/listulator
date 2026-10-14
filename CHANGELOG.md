# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow [Semantic Versioning](https://semver.org/).

## [1.0.2] - 14 October 2026

### Fixes
- If Listulator detects that its screen goes beyond usable monitor area upon launching, it resizes itself to properly fit the usable area


## [1.0.1] - 14 October 2026

### Fixes
- Startup performance on Windows was improved: the app loads noticeably faster
- App update on Windows now remembers window size & position
- Four cosmetic bugs were fixed, increasing the level of design polish


## [1.0.0] - 13 October 2026

### Initial Release

- A desktop app for Windows and macOS that hosts your list library on your own computer
- Create and work on lists:
	- Add lists via search, by hand, or through an imported YAML file
	- Edit lists: change their name, description, and status
	- Lists can have one of the following statuses: Complete (no new items will be added to it), Ongoing (new stuff is coming out), or Schrödinger (no idea whether any new stuff is coming)
	- Track each list's progress at a glance
	- Filter a list by text, use category-specific filters (Platform, Type, Language), or toggle Hide Completed. Each list remembers its own Hide Completed setting
	- Group items within a list and quickly navigate large lists using the "Jump To" group navigator
	- Export lists to a YAML file or to the clipboard
	- Sort lists, reordering items within by year or by original list order (if applicable)
	- Reset lists added from Search or the List Vault to their source versions. Note that these lists may have gained new items since you added them
	- Delete lists
- Work on list items:
	- Add your own list items and assign them to new or existing groups, if needed
	- Tick items as done. You don't have to click the checkbox -- click anywhere on the item's row, just make sure you don't hit another control
	- Edit item's name, duration, group, plus category-specific data like platform for games
	- Reorder items by drag'n'dropping them by their "handle" or by clicking on them and using Shift+Up & Shift+Down
	- Group and ungroup items. Grouped items can only be reordered within a group (change the group in item properties to move items between groups)
	- When reordering a group, all other expanded groups automatically collapse. Once you finish the reordering, groups that were previously expanded will re-expand automatically
	- Delete items
- Choose from twelve categories with built-in search:
	- Movies, TV Shows, Animation and Documentaries (TMDB)
	- Wrestling and MMA (Wikipedia) 
	- Games (IGDB) 
	- Comics (Comic Vine)
	- Books (Open Library)
	- Music (MusicBrainz) 
	- YouTube (YouTube Data API)
	- Mega: a meatbag-curated library of canonical cross-media franchise lists (List Vault)
- Check for updates to lists added from search or the List Vault
- Use four helper buttons when you don't know what to pick up next (see [README.md](README.md) for details)
- Other features:
	- Supported platforms: Windows (64-bit) and macOS (Apple silicon, macOS 11 or newer)
	- Built-in app update mechanism
	- 5-second Undo on disruptive and destructive operations
	- API keys management interface (including key testing) for sources that require them, with links to guides that explain how to get these keys
	- YouTube playlists and channels carry each video's publish year, so they can be sorted by year if you don't like the playlist sorting
	- Quantum theme with five skins (4 dark, 1 light)
	- First app launch chooses a random skin, feel free to change it (your preference is saved)	
	- English, Russian, and German localizations (English & Russian are meatbag-validated, German is clanker-driven)
	- "Fullscreen" option, "Reduce animation motion" option, and a Quit / Exit button

### Known issues & limitations

- The installers are not code-signed or notarized: Windows SmartScreen and your browser may warn, and macOS asks you to
  allow the app in Privacy & Security the first time. The README says how.
- Macs with an Intel processor are not supported.