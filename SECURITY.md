# Security policy

Listulator is a hobby project kept by one person. This page says how to report a security problem and what to
expect. Thank you for taking the trouble.

## Reporting a problem

Please report it **privately**, through GitHub:
[Report a vulnerability](https://github.com/gerharar/listulator/security/advisories/new)
(the repository's *Security* tab → *Report a vulnerability*).

Please do not open a public issue or pull request for a security problem, and do not post it elsewhere before it is
fixed.

A good report says what you found, how to reproduce it (the version or commit, the operating system, the steps), and
what you think an attacker could do with it. **Never include your own API keys or personal data** in a report.

## What is covered

- The **Windows and macOS apps** built from this repository.
- The **community list library** (`lists/`) and how the apps read it: for example a list file that makes an app
  misbehave, or a way to change what every installed app fetches.
- The **build pipeline**: the workflow in `.github/workflows` and what it produces.

## What is not covered

- **Self-hosting** the server and web app. The code is open and it may work, but it is not a supported way to run
  Listulator; reports about it are welcome and will be read, but may not be treated as vulnerabilities.
- Problems in the services Listulator talks to (TMDB, IGDB, Comic Vine, YouTube, MusicBrainz, Open Library, Wikipedia,
  GitHub): please report those to the services.
- Attacks that already need code running as you, physical access to an unlocked computer, or a computer you do not
  control.
- Findings in a dependency with no way to reach it from the apps.

## Which versions

Only the **latest release** is supported. A fix is published as a new version rather than added to an older one, so
if you are not on the latest release, update first and check whether the problem is still there. Pre-releases
(versions like `1.0.0-rc.1`) are for testing and are not supported once the release they lead to is out.

## What you can expect

This is one person's spare time, so these are intentions, not promises: I aim to acknowledge a report within a week,
to tell you what I decide, to fix what is real, and to credit you in the fix if you wish. There is no bounty. Please
give me a reasonable time to fix a problem before you talk about it publicly, and please only test against your own
installation and data.
