# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow [Semantic Versioning](https://semver.org/).


## [1.2.1] - 28 October 2026

### Improvements

- **Up/Down** button is now always shown to avoid UI jumping around when user hides done items
- Moved additional filters to dropdowns, reducing visual clutter. *Music* category's *Recording* filter was expanded to **Live** / **Studio** and moved to a separate dropdown
- A new option in **Settings** > **Screen** adds visual aid beside each group's arrow indicator to help you understand faster if a group is expanded or collapsed

### Fixes

- Listulator now cleans up after deleted lists at start
- Minor UI/UX fixes
- Minor localization updates
- Minor security issues fixed


## [1.2.0] - 27 October 2026

### New Stuff

- New onboarding & list-adding experience has arrived for the first-run and **New List** screens:
	- First-run screen explanations have been improved for clarity
	- A *List Vault* shelf is now shown below the category tiles, offering three random canonical lists from the List Vault in three random categories
	- You can now actually browse the List Vault! Use **Browse List Vault** button on the **New List** screen to discover the whole List Vault library. It's self-explanatory, with sortable columns (title, items, time) and a separate *In My Lists* tag for lists you're already tracking
	- FYI: List Vault is regularly getting new lists, and accessing them does not require updating Listulator itself
	- **Try A Sample List** button on the first-run screen adds and opens a big canonical list that shows a new user how the lists work. You can **Keep It** or **Delete** it (with Undo available, of course)
	- Category tiles now show a *Free Key Needed* tag if a category needs an API key to access its main data source and it hasn't been provided yet
	- Categories without API keys now show a field for pasting the key when you open them, with a link to a guide that explains how to get the key
- List navigation got some new toys:
	- **Jump To** element now resides outside the card when the app window has enough room. And the **Preview** screen has it too!
	- A split **Up/Down** button was added to the toolbar for long lists so that you can quickly jump to the top or bottom of the list
	- You can use your keyboard's *Up* and *Down* arrow keys for navigating a list, or *Shift+Up* and *Shift+Down* for moving the active item higher or lower in the list
	- *Home* and *End* on your keyboard will take you to the start or the end of a list (note: the focus needs to be on the list items in order for these keys to work)

### Improvements

- Descriptions and hints now occupy more real estate (previously unused) on the right side of various windows and fields. Very long words will break instead of overflowing
- Update check button on **My Lists** page now skips lists with *Complete* status

### Fixes

- In the rare case of deleting a large group going wrong for some reason, the list no longer freezes
- Minor security issues were fixed


## [1.1.1] - 22 October 2026

### Fixes
- Update notice on **About** screen now warns Windows users that Listulator will close automatically during the update, disappearing for up to 15 seconds. This delay is caused by Windows Defender background checks
- After the update, a one-time message will be displayed about Listulator being updated to a particular version
- Installer-run Update window on Windows (heh) now should always come to the front without getting lost behind other windows
- A stuck install or update no longer hangs forever -- the timeout is now 60 seconds. If this happens, just try again, it should work the next time
- Minor UX bugs were fixed
- Minor security issues were fixed


## [1.1.0] - 19 October 2026

### New Stuff

- Items added via Search in most categories (except **Books**, **Wrestling**, **MMA**, and **Mega**) now have links to the corresponding page of the source website. This is particularly useful for YouTube lists
	- BTW, did you know you can paste the playlist URL from YouTube into Listulator's YouTube search to get a list based on this playlist? Well, now you do!
	- Items in **TV Series** will show links only if the individual episode names in the list start with an episode code like *S01E02*
	- Items in **Games** take their time to get their link, please be patient (finding slugs requires moving at a slug's pace, apparently)
- Personal notes (up to 2048 characters) can be added in the **Edit** window for any item. To see a note for a given item while browsing a list, click **(i)** (only shown if there's a note present). Curator notes from Canonical Lists are shown separately in the same card, if they're present
	- List filter now also searches in notes. If it finds something that's only present in a note, the **(i)** will change its color
	- **Reset** clears your notes, **Undo** resurrects them. Other operations like sorting, reordering, or updating your list do not touch your notes
	- List exports do not include your notes
- You can now specify a year when adding or editing an item. Don't know the exact year? No worries, the app also accepts *?* where applicable (example: *199?* or *20??*)
	- Lists added manually via **Use Hands** can now take a year in closing brackets, for example: *Fast Five (2011)*
- Item durations are now accepted in more than just minutes (*95*): you can also use *1h 35m*, *1h35m*, or *1:35*

### Improvements

- Listulator now supports lists up to 50000 items for imported and curated lists. Lists made from a connector search (TMDB, IGDB, and so on) are limited to 10000 items
	- Large lists now open fast(er) and scroll smoothly
	- Previews of large lists are also faster now
- **Filter** field now has an **x** button to clear the typed text. Alternatively, you can hit **Esc** to do the same
- Forms now have proper validation and show what's wrong instead of silently disabling buttons
- Improved UX and overall clarity of dragging items and groups around, especially when you rearrange a group across other large groups that don't fit the screen
	- Removed sudden auto-folding of all groups when stuff was dragged around. Only the group you're dragging is now collapsed automatically during the dragging
- **Reset**, **Restore Source Order**, and **Undo** now prevent users from accidentally messing up their lists when these tasks are running on large lists (we're talking thousands of items). This is done by blocking most operations (except quitting the app) during these tasks
- Listulator will now warn users who try to quit it when a long-running task (like resetting a 30k-item list) is running
	- Known limitation: quitting the app on Mac via **Cmd+Q** or the app menu bypasses this warning. If you accidentally screw up your database by quitting mid-task, launch the app and run the task again (unless it was **Undo** -- my condolences then)
- Estimated item length is now marked with *≈*, so that you know it's not an exact measurement, but merely a shot in the dark
- Group headers now show how many items in them match your filter

### Fixes

- Several elements had their visuals updated to conform to the **Quantum** design system
- First launch on a fresh database no longer creates the local user twice 
- Minor security improvements


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
	- Lists can have one of the following statuses: *Complete* (no new items will be added to it), *Ongoing* (new stuff is coming out), or *Schrödinger* (no idea whether any new stuff is coming)
	- Track each list's progress at a glance
	- Filter a list by text, use category-specific filters (*Platform*, *Type*, *Language*), or toggle *Hide Completed*. Each list remembers its own *Hide Completed* setting
	- Group items within a list and quickly navigate large lists using the **Jump To** group navigator
	- Export lists to a YAML file or to the clipboard
	- Sort lists, reordering items within by year or by original list order (if applicable)
	- Reset lists added from Search or the List Vault to their source versions. Note that these lists may have gained new items since you added them
	- Delete lists
- Work on list items:
	- Add your own list items and assign them to new or existing groups, if needed
	- Tick items as done. You don't have to click the checkbox -- click anywhere on the item's row, just make sure you don't hit another control
	- Edit item's name, duration, group, plus category-specific data like platform for games
	- Reorder items by drag'n'dropping them by their "handle" or by clicking on them and using **Shift+Up** & **Shift+Down**
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
	- 5-second **Undo** on disruptive and destructive operations
	- API keys management interface (including key testing) for sources that require them, with links to guides that explain how to get these keys
	- YouTube playlists and channels carry each video's publish year, so they can be sorted by year if you don't like the playlist sorting
	- **Quantum** theme with five skins (4 dark, 1 light)
	- First app launch chooses a random skin, feel free to change it (your preference is saved)	
	- English, Russian, and German localizations (English & Russian are meatbag-validated, German is clanker-driven)
	- **Fullscreen** option, **Reduce animation motion** option, and a dedicated **Quit** / **Exit** button

### Known issues & limitations

- The installers are not code-signed or notarized: Windows SmartScreen and your browser may warn, and macOS asks you to allow the app in **Privacy & Security** the first time. The README says how.
- Macs with an Intel processor are not supported.