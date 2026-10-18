# Very long lists: turning the "draw only what you see" mode off

Last checked: 2026-10-18

Since version 1.1.0 a list of 200 or more rows is drawn a screenful at a time: the app puts on the page only the rows you can see (and a few more above and below), and keeps the scroll bar the size of the whole list. That is what lets a list of 30,000 items open in a second instead of half a minute. The Preview you see before adding a very long list from a source (a big List Vault list can have tens of thousands of items) is drawn the same way.

It is on by default and you should not need to touch it. There is no setting for it in the app on purpose. This guide is for the day it gets in your way (for example a screen reader or a browser extension that needs every row on the page at once, or a problem you want to rule out before reporting it). With the mode **off**, every row of every list, and of every Preview, is drawn, as in version 1.0.2: short lists look and work the same, and very long lists get slow (a list of 10,000 items takes several seconds to open, and 50,000 items can take minutes; a Preview of 50,000 rows takes several seconds to open and feels sluggish to scroll).

What changes with it **on**, so you know what you are turning off:

- The browser's own find-in-page (Ctrl+F or ⌘+F) finds only the rows that are drawn. The filter box above the list searches every item, and its notes, and is the way to find something in a long list. The Preview has no filter box: scroll it to reach the rest.
- Selecting text and copying it does not reach rows that are not drawn.
- Each drawn row tells a screen reader its place ("4212 of 30000"), and the list (or the Preview) says that only the rows near the screen are drawn.

## Turn it off, in the desktop app (Windows and macOS)

The app keeps its preferences in a file called `preferences.json`. **Quit Listulator completely first** (⌘Q on a Mac, or the Exit button at the top of the app on Windows), then edit the file; it takes effect the next time you start the app. If you edit the file while the app is running, the app can write its own copy back over your change, and the line is lost.

| System | Where the file is |
|---|---|
| macOS | `~/Library/Application Support/com.listulator.desktop/preferences.json` (in Finder: Go, Go to Folder, paste the path) |
| Windows | `%APPDATA%\com.listulator.desktop\preferences.json` (paste it into the Explorer address bar) |

(A development build, run with `npm run dev -w @listulator/desktop`, uses `com.listulator.desktop.dev` instead.)

1. Open the file in any text editor. It is a short list of settings in curly braces, like `{ "skin": "…" }`.
2. Add this line inside the braces, with a comma after the line before it (if the file is empty or missing, make it contain exactly `{ "listVirtualization": "off" }`):

   ```
   "listVirtualization": "off"
   ```

3. Save, and start Listulator again.

To turn it back on, delete that line (or write `"auto"`). The words `off`, `false`, `0` and `no` all mean off, in any case; anything else, or no line at all, means on.

## Turn it off, in the browser (the self-hosted web app)

Open Listulator in the browser, open the developer console (F12, then Console), and type:

```
localStorage.setItem('listVirtualization', 'off')
```

Then reload the page. To turn it back on: `localStorage.removeItem('listVirtualization')`. The setting belongs to that browser and that address (for example `http://localhost:5173` and `http://192.168.1.20:5173` are two different places).

## Turn it off for everyone, on the server (self-hosting)

If you run the server yourself, put this in your `.env` file (or in the `environment:` of your Docker setup), then restart the server:

```
LIST_VIRTUALIZATION=off
```

It applies to everyone who opens that server in a browser. The accepted values are `auto` (the default) and `off` (also `false`, `0` and `no`); anything else stops the server at start with a message that names the setting. If the server says off, or the browser's own setting says off, the list is drawn whole: neither can force it back on. The desktop app has no server and only reads its own `preferences.json`.

## If it was a problem

If turning it off fixed something, please [tell us what you saw](https://github.com/gerharar/listulator/issues): the system, the app version (the About button at the top of the app), roughly how many rows the list has, and what went wrong. The mode is a safety net, and that report is what it is for.
