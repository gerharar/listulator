# Restoring a backup of your lists

Your lists live in one file, `listulator.sqlite`, in the app's data folder. The first time the desktop app starts after it has been updated, and before the new version touches that file, it saves a copy of it. The copies are kept in a folder called `backups`, and the newest three are kept; older ones are removed.

This guide is for the day the lists will not load after an update (the app says "Couldn't load your lists" and Retry does not help), or when something went wrong that you want to undo. It does not cover your preferences or your API keys: those are other files in the same folder, and a restore leaves them alone.

## Where the copies are

Open the app's data folder, then the `backups` folder inside it.

| System | The backups folder |
|---|---|
| macOS | `~/Library/Application Support/com.listulator.desktop/backups` (in Finder: Go, Go to Folder, paste the path) |
| Windows | `%APPDATA%\com.listulator.desktop\backups` (paste it into the Explorer address bar) |

(A development build, run with `npm run dev -w @listulator/desktop`, uses `com.listulator.desktop.dev` instead.)

A copy is named `listulator-before-<version>-<date>-<time>.sqlite`, for example `listulator-before-1.4.1-20261115-221320.sqlite`.

- The **version** is the one that made the copy, the version you had just updated to. The copy holds your lists as the version before it left them, so if the trouble began after updating to 1.4.1, the copy you want is the one named `before-1.4.1`.
- The **date and time** are in UTC, not necessarily your clock's: year, month, day, then hour, minute, second.
- A copy is made only when the version changes. The first one is made the first time you start version 1.4.1 or later; before that there is no `backups` folder, and nothing to restore from.

You may also see files in this folder that do not start with `listulator-before-`: copies made by hand. The app leaves them alone.

## Put a copy back

Anything you changed in the app after the copy was made will not be in it.

1. **Quit Listulator completely** (⌘Q on a Mac, or the Exit button at the top of the app on Windows). If you restore while the app is running, it can write its own copy back over yours.
2. Open the data folder, the one **above** `backups`.
3. **Move aside, do not delete,** these files to another folder, such as your Desktop: `listulator.sqlite`, and, if they are there, `listulator.sqlite-wal` and `listulator.sqlite-shm`. All three belong together; a restored file with an old `-wal` beside it can come back wrong.
4. Copy the backup you chose from `backups` into the data folder (copy, so the backup stays), and rename the copy to exactly `listulator.sqlite`.
5. Start Listulator.

If your lists are back, you can delete the files you moved aside. If they are not, quit the app, put the moved files back, and tell us (below).

## If it was a problem

If the app needed a backup, please [tell us what you saw](https://github.com/gerharar/listulator/issues): the system, the app version (the About button at the top of the app), and what the app said. Do not attach `listulator.sqlite` or a backup: they hold everything you have added to the app.
