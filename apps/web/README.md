# apps/web

The cicis app: React + SQLite-wasm, wrapped for iOS with Capacitor (`ios/`).

## A diagnostic TestFlight build (web view inspectable)

Release builds, TestFlight included, are not inspectable by default. For a build meant for reading the sync log
on a phone with Safari's Web Inspector, set `CICIS_INSPECTABLE=1` when syncing:

```sh
cd apps/web
CICIS_INSPECTABLE=1 npm run cap:sync
grep webContentsDebuggingEnabled ios/App/App/capacitor.config.json   # must print "webContentsDebuggingEnabled": true
```

The variable does two things, and only together:

- `capacitor.config.ts` writes `"webContentsDebuggingEnabled": true` into `ios/App/App/capacitor.config.json`, so the
  release web view is inspectable (Capacitor maps it to `WKWebView.isInspectable`).
- `vite.config.ts` sets `VITE_INSPECTABLE=1` for the web build, so `bootstrap.ts` installs the read-only console
  helper `window.__expansesSync` (`src/sync/sync-console.ts`). `npm run build` prints `DIAGNOSTIC build: ...` when it
  is in the bundle.

Then archive and upload from Xcode as usual. The flag is read at `cap sync` time, so the archive carries whatever the
last `cap:sync` wrote.

**Never for the App Store.** Anyone with the unlocked phone and a Mac can read the whole database through the
inspector. Before archiving any other build, sync again without the variable and check:

```sh
npm run cap:sync
grep -c webContentsDebuggingEnabled ios/App/App/capacitor.config.json   # must print 0
```

Reading it: on the iPhone, Settings > Apps > Safari > Advanced > Web Inspector on; on the Mac, Safari > Settings >
Advanced > Show features for web developers. With the phone on a cable and cicis open, Safari > Develop > the
iPhone > cicis. In the Console, `await __expansesSync.log()`, `await __expansesSync.sharedBooks()`, or
`copy(await __expansesSync.sharingDetail('<bookId>'))`. Without a cable, Share > Details > Copy details works in
every build.
