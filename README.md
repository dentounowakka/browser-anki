# Browser Anki

This is a standalone browser-only memorization app added to the Anki source
tree. It does not require Anki's Python, Qt, Rust backend, AnkiWeb, or a local
server after the static files have been loaded.

## Features

- Deck and card management in the browser
- Offline-first storage with IndexedDB
- PWA manifest and service worker for cached launches on `localhost` or HTTPS
- Due-card review flow with Again, Hard, Good, and Easy ratings
- Browser port of Anki's non-FSRS scheduler concepts:
  `New`, `Learning`, `Review`, `Relearning`, queues, learning steps,
  graduating intervals, ease factor changes, lapses, and leech marking
- Deck-level review settings inspired by Anki Deck Options:
  learning steps, graduating intervals, Hard factor, Easy bonus, interval
  modifier, maximum interval, lapse steps, lapse multiplier, minimum lapse
  interval, and leech threshold
- Review-ahead sessions inspired by Anki Custom Study `ReviewAheadDays`
- Separate study and management screens
- Per-card answer mode: self grading or typed answer before grading
- Image attachments stored locally with each card
- Deck-grouped card browser with search
- JSON backup/restore
- CSV import with configurable columns for front, back, tags, deck, answer mode,
  image, and image side
- Local review history and lightweight statistics

## Anki compatibility notes

This app keeps the runtime browser-only, so it does not directly execute Anki's
Rust backend, SQLite collection layer, or FSRS crate. The card state model and
the default non-FSRS scheduling path are adapted from Anki's `rslib`
scheduler: learning steps default to 1 and 10 minutes, Good graduates after the
learning steps, Easy graduates to 4 days, review cards use ease factor changes,
and failed review cards enter relearning.

## Run

From this repository:

```powershell
python -m http.server 4174 --bind 127.0.0.1 --directory browser-app
```

Then open:

```text
http://127.0.0.1:4174/
```

Opening `index.html` directly also works for the main app, but the service
worker can only be registered from `localhost` or HTTPS.

## License

This folder is part of the cloned Anki repository and follows the repository's
AGPL-3.0-or-later license.
