# Roundhouse Release Notes

## v0.5.4 — 2026-05-10

### Hotfix: v0.5.3 crashed on Windows at launch
- **What you'd see**: a blue-bordered "A JavaScript error occurred in the main process" dialog with `Error: Cannot find module 'archiver-utils'` immediately after launching the updated v0.5.3 build. Mac users were unaffected.
- **Root cause**: when `archiver` (the zip library added in v0.5.3 for the Backup feature) loaded, it required `archiver-utils` from `app.asar/node_modules/...`, but electron-builder's production-deps walker had dropped that hoisted transitive dep from the asar on Windows. Known quirk.
- **Fix**: bundle `archiver` and all its transitive deps directly into the main JS at build time, so there's no runtime `require` chain for the packaging walker to walk through. No behavior change — Backup, CSV export, everything else is identical to v0.5.3, just without the crash.

## v0.5.3 — 2026-05-06

### Backup button (resolves #11)
- **Settings → Data → 📦 Backup…** writes a portable `.zip` containing your full Roundhouse data: the `roundhouse.db` database plus every photo and video. Stash it on a USB drive, in cloud storage, anywhere safe — restore it on a new machine and you're back where you left off.
- DB snapshot uses SQLite's online-backup API, so it's consistent even with the live DB open and WAL active.
- Result dialog summarizes counts + size + duration with a **Show in folder** button so you can confirm the file landed.
- Note: backups are your *data*. The app itself you reinstall normally — don't try to back up the install folder, that's where the ffmpeg.dll error in the original report came from.

### CSV export — Windows triage
- After saving, you now get a confirmation dialog with a **Show in folder** button (Explorer on Windows, Finder on macOS) so failures are obvious.
- Save errors now show a clear error dialog instead of dying silently. Diagnostic logging records the path written, byte count, and any error.

## v0.5.2 — 2026-05-06

### Coin book totals (resolves #10)
- **Stat tiles at the top of every coin book.** Open any book that has at least one coin in it and you'll see four tiles right under the header: **Coins · Units · Current value · Purchased**. Numbers refresh live as you add, remove, or delete coins.
- "Units" is the sum of `quantity` across all coins in the book — a stack of 10 of the same coin counts as 10 units.
- Empty books (no coins yet) hide the tiles entirely so the page doesn't read as a row of zeros.
- Train sets are unchanged.

## v0.5.1 — 2026-05-01

A polish pass on top of v0.5.0 — coin-shaped UI everywhere it should be, video support, real grouping for coins, and import without Python.

### Coins side gets its own theme
- **Navy blue palette.** Every coin-side screen — `/coins`, `/books`, the home page Coins card, the Coins tab in Settings, set/item detail when the parent is a coin collection — paints in steel-blue and dark navy to match the ROUNDHOUSE plaque and "COIN COLLECTION" book in the background image. Trains side stays brown. The body class flips automatically.
- **Coin Condition grading.** The "?" help dot beside Condition now opens the **Sheldon scale** (P-1 through MS-70 + Proof) on coins, instead of the TCA train-grading list. Existing imported coin condition values were normalized to the value keys (Mint→mint_state, Proof→proof, etc.).

### Books — real groupings for coins (resolves #6 conceptually)
- **`/books` page** lists coin "books" (Whitman folders, Dansco albums, custom groupings — really just sets in the coin collection). Create / rename / delete books from there.
- **Coin item form** has a new **Book** dropdown so you can assign each coin to a book at edit time.
- **Quick-add coins to a book**: open a book → "Add existing coins" → searchable, multi-select picker → submit, all selected coins are assigned at once.
- **Remove without delete**: each row inside a book/set has a ↩︎ button that pulls the coin out of the book without deleting the coin from the collection.
- **Coin sub-nav** on `/coins` → **All / Mints / Proofs / Books**. All/Mints/Proofs are in-page filters; Books navigates to `/books`.

### Photos & videos (resolves #9)
- **Videos alongside photos.** The Add dialog now accepts `mp4`, `webm`, `mov`, `m4v` in addition to images. Videos play in the same lightbox with controls and autoplay, and show as a tile with a ▶ overlay + VIDEO badge in the gallery. Trains and coins both supported.
- Videos can't be set as the primary thumbnail (the home card / list thumb stays an image).

### Sticky table headers (resolves #8)
- The Trains / Coins / Books tables now scroll **inside** a fixed-height wrap, with column headers locked at the top. The wrap adapts to viewport height. Print output still expands every row.

### Renaming + Settings polish
- **Rename your collections.** Settings → Trains tab and Settings → Coins tab each have a Name + Description editor at the top. Saving updates the home card, print headers, and everywhere else the name appears.
- **Trains sub-nav** on `/trains` and `/sets` — pill links **Items / Sets** so you can hop between the two without losing context.
- The old in-page **Search tips** popover was replaced by the cleaner sub-nav layout.

### In-app xlsx import (no Python needed)
- **Import Excel** button on the Trains and Coins page headers. Pick an .xlsx, columns auto-detected by header name; rows insert into the kind's collection in a single transaction. Handles the same column shape the Python scripts did (Scale/Mfg/Number/Item/... for trains, Type/Country/Currency/Denomination/... for coins).

### Item detail
- **Kind-aware fields.** Coin items show *Country / Face value / Denomination / Mint mark / Year / Quantity*; trains show *Scale / Mfr / Model # / Road name / Era / Year*. No more "—" placeholders for irrelevant fields.
- **Correct top-nav highlight + breadcrumb.** Drilling into a coin item now highlights **Coins** in the top nav and breadcrumbs as `Coins › <name>` (or `Coins › Books › <book> › <name>`). Same parity for trains.

### Bug fixes
- Edit dialogs and Search-tips popovers no longer bleed the brown surface color when on a coin screen.
- The list-row primary thumbnail SQL filters to `media_type='photo'` so a video can never be served as an `<img>`.

### Schema
- `item_photos.media_type` column added (photo | video). Migration backfills existing rows to 'photo'; fresh installs get the CHECK constraint.

## v0.5.0 — 2026-04-30

### Coins are first-class now
Roundhouse is no longer just for trains. Every collection is now tagged with a *kind* — **trains** or **coins** — and the entire UI follows suit.

- **Two collections, side-by-side.** The home screen now opens onto your real wallpaper with two small cards near the bottom: 🚂 **Trains** and 🪙 **Coins**. Each shows item count and total value. The old single-card layout that hid the background is gone.
- **Top nav matches.** The header now reads **Trains · Coins · Requests · Settings**. The Trains tab opens your train inventory list (same as before, just filtered to kind=trains). The Coins tab opens an inventory list with coin-specific columns.
- **Coin-specific fields.** Coin records carry *country*, *face value*, *denomination*, *mint mark*, *year*, *quantity*, *condition*, and *current value* — instead of *scale*, *manufacturer*, *model #*, *road name*, and *era*. The add/edit form changes shape based on which collection you're in.
- **Coin-specific listing.** The Coins page columns are *Type · Country · Year · Denomination · Mint · Qty · Value · Total*. Filters include Country instead of Scale. CSV export uses coin-shaped columns.
- **Coin-specific lookups.** Settings → Lookups gained a **Trains / Coins** tab at the top. Each kind has its own Type and Condition lists (coins ship with the Sheldon scale: poor through proof; bills with crisp uncirculated, etc.). Scale only exists for trains.
- **eBay query is kind-aware.** Looking up a coin builds a query around year + country + face-value/denomination + mint mark instead of manufacturer + model #. Search results stay tightly relevant.

### New background
- The home screen now uses a trains+coins+globe collage with the embedded plaque "ROUNDHOUSE — TRAINS · COINS · JOURNEYS." Replaces the previous train-only scene.

### Migration
- Existing trains DBs migrate forward automatically: all existing items get linked to a "trains" collection, lookup tables grow a `kind` column with backfilled values, and a default "Coin Collection" is auto-created so the Coins tab works on first run.

## v0.4.7 — 2026-04-30

### Drag-to-reorder dropdown options
- **Settings → Item types / Scales / Conditions** rows are now draggable. Grab a row by its grip handle (⠿) and drop it where you want it; the order persists immediately and that's the order it appears in the matching dropdown when you create or edit an item.
- Removed the manual "Sort order" number field from the Edit dialog — the drag handle replaces it. Cleaner UX, harder to mess up.
- Resolves #7.

## v0.4.6 — 2026-04-30

### The actual Windows fix (this time, with proof)
The diagnostic log shipped in v0.4.5 paid off on the very first session: it showed two specific bugs in the app code, not Norton, not the user's machine.

- **Right-click context menu now actually attaches to the window.** Previously the listener was registered after the window was created, which on Windows raced — so the Surface user's renderer fired contextmenu events that main's handler never received. Listener is now bound directly to the window's webContents.
- **Edit menu's Paste replaced with a custom IPC pipeline.** The previous `role: 'paste'` worked on Mac but silently failed on Windows + sandboxed renderer (the diag log showed zero paste events firing despite Ctrl+V being pressed). The new Paste reads the OS clipboard via main's privileged Electron API and inserts the text at the caret directly. Same accelerator, same UX, working pipeline.

## v0.4.5 — 2026-04-30

### Diagnostic instrumentation
- New **Help → Show Diagnostic Log** menu item opens a captured event log in your text editor. The log records every paste, every keydown Ctrl+V, every right-click, every clipboard read, and any errors — with timestamps, target element details, clipboard format inventory, and OS / app version context.
- **Help → Reset Diagnostic Log** wipes it so a fresh test produces a clean trace.
- Use case: when something doesn't behave (paste fails, right-click silent, etc.), reproduce the issue, open the log, and email the contents to the developer. Replaces guess-and-ship-and-hope debugging with concrete data.

## v0.4.4 — 2026-04-30

### Windows clipboard, take three (the bulletproof one)
- v0.4.2 / v0.4.3 didn't actually fix the Windows paste and right-click issues. This release retries with a more aggressive strategy that bypasses every layer that could be breaking.
- **Paste now reads from Electron's privileged clipboard API in the main process** when the renderer's clipboardData is empty. Three layers of fallback: text/plain → text/html (tag-stripped) → OS-level clipboard via IPC. At least one of these will work for any normal copy.
- **Ctrl+V is also intercepted at the keydown layer** so we don't depend on Chromium dispatching a paste event in the first place — useful if some Windows quirk is suppressing it entirely.
- **Right-click context menu now binds explicitly to the source window** (some Windows installs need the popup target window set explicitly, otherwise the menu never paints).
- Right-click menu now always includes an **Inspect** item so we can verify on a screen-share that the menu is firing at all.

## v0.4.3 — 2026-04-29

- **Right-click on highlighted text now shows a Copy menu**, even on read-only labels (item names, descriptions, manufacturer text, etc.). Previously the context menu only appeared in editable fields, so highlighting a value to copy out and right-clicking gave nothing on Windows. The menu now also shows on any selected text outside an input.

## v0.4.2 — 2026-04-29

### Windows-only paste fix
- **Pasting from ChatGPT, eBay, and other rich web sources now works on Windows.** Previously, the default paste path on Windows wasn't reliably grabbing the plain-text variant when the clipboard also held rich HTML — common for copies out of websites and AI chat. The app now intercepts the paste event and pulls the plain text directly from the clipboard, sidestepping the format-priority issue. macOS already worked correctly and remains unchanged.

### Under the hood (dormant)
- New "Active eBay listings" section on each item's detail page. Shows a graceful "Not set up yet" message until the developer drops eBay API credentials into the app's data folder; will then surface up to 12 matching active listings per item with thumbnails, prices, conditions, and a click-through to the eBay listing. This will light up in v0.5.0 once credentials are in place.

## v0.4.1 — 2026-04-29

### UX corrections
- **Logo click goes Home.** Clicking the Roundhouse logo in the top-left now navigates back to the Home view, the standard convention every app on the planet has used for decades. No more opening About by accident.
- **Removed the redundant Home tab** from the menu bar. The logo is the Home button.
- **About Roundhouse moved to the menu bar** (where it belongs). On macOS it's under the **Roundhouse** app menu; on Windows/Linux it's under **Help → About Roundhouse**. It's a native OS About dialog showing the version and a **Release Notes…** button. Clicking that opens an in-app modal with the full release history (previously the modal was awkwardly bolted onto the logo click).

## v0.4.0 — 2026-04-29

### Photo gallery, big upgrade
- **Click a photo to enlarge.** Tap any thumbnail in an item's gallery and a fullscreen lightbox opens. Use the arrow keys, the on-screen ‹ › buttons, or click outside to dismiss.
- **Captions per photo.** A text field sits under each photo — type a caption (e.g. "after restoration", "side detail", "box label") and click away. Saved automatically. Edit any time.
- **Pick a primary photo.** Each tile has a ★ button. Click it on any photo to mark it primary; that photo becomes the thumbnail you see for that item on the Items list. The primary tile is outlined in gold and shows a small ★ badge.
- **Drag tiles to reorder.** Grab any tile and drop it on another to change the order. The order persists.
- **Items list shows photo thumbnails.** A new first column renders the primary photo at 36×36 next to each item, with a 📷 placeholder for items that don't have any photos yet.
- **Smart-search by photo coverage.** Type `photos:` to find every item missing a photo, or `-photos:` to filter to items that have at least one. Click the **?** next to the Search box for the full syntax reference.

### Condition grading
- New **?** help-dot next to the Condition field — both on the Item Detail view and inside the Edit dialog. Click it for an inline guide explaining what each condition (New / Like new / Excellent / Good / Fair / Poor / For parts) means against the **TCA (Train Collectors Association)** grading standard, the industry reference used by auction houses and price guides.

### What's new dialog
- Click the **Roundhouse** logo in the top-left to open the About dialog. It now shows the version, copyright, and inline release-history rendered from the bundled `CHANGELOG.md`. No internet needed; the notes always match the version installed.

### Under the hood
- Schema migration adds `is_primary` to `item_photos`, with each item's existing earliest photo flagged as primary so the new "primary" concept retroactively makes sense across legacy data.
- Renderer build pipeline now exposes a `npm run start` command that builds the bundle and launches Electron against it — used internally for deterministic testing without HMR.

## v0.3.1 — 2026-04-28
- 🖨 **Print** button on the Items list — opens the system print dialog with a clean paper layout (running header, page numbers in the top-right, repeating column headers, no rows split across pages).
- 📊 **Export CSV** button — saves the currently filtered list to a `.csv` file, UTF-8 BOM so Excel detects encoding correctly, RFC-4180 escaping. All 16 columns.
- **Smart search syntax** in the Items search box. Examples: `mfg:bachmann` (restrict to a column), `mfg:` (column is blank — find items missing a manufacturer), `-mfg:` (only items with a manufacturer), `-bachmann` (exclude), `scale:HO -mfg:` (combine), `"box car"` (quoted phrase). Click the **?** dot next to the Search label for the full syntax help.
- Real **Roundhouse app icon** for Windows, macOS, and Linux (no more generic Electron atom).
- Mac DMG and Linux AppImage targets added to electron-builder config (CI still only builds Windows by default).
- Resolves #4.

## v0.3.0 — 2026-04-28
- **Settings tab** — manage the dropdown values for Item Type, Scale, and Condition.
  - Add custom types (e.g., *passenger_car*, *trolley*) beyond the eight built-ins.
  - Add specialty scales (e.g., *ON30*, *1/64*) on top of Z/N/HO/OO/S/O/G.
  - Add or rename condition labels.
- Built-in entries are flagged "Built-in" — their underlying value is locked so existing items don't break, but you can still rename their label (so "Other" can read "Miscellaneous" in your dropdowns).
- User-added entries can be renamed or deleted freely. Deleted values stay on existing items, just disappear from the dropdown.
- One-time migration drops the `CHECK` constraint on `items.type` so user-defined types can be saved.
- Resolves #2.

## v0.2.2 — 2026-04-28
- Right-click in any Description, Notes, or Subject field now shows a context menu with **Cut / Copy / Paste / Paste as plain text / Select All**. Pasting from ChatGPT or external sites works as expected. Resolves #3.
- The "Purchased" column on the Items list no longer wraps a date onto two lines. Date stays on one line, prices stay tabular-aligned alongside. Resolves #5.

## v0.2.0 — 2026-04-28
- **Auto-update** via `electron-updater` and GitHub Releases. Checks on launch and every four hours. Once you're on v0.2.0+, future versions install automatically with a one-click "Restart now" prompt.
- **Requests tab** — send the developer feedback, ideas, bug reports, or questions; they post as GitHub Issues. Replies appear inline next to each request. Requires a one-time `feedback.json` config file shipped with the seed.
- New `source` field on items — track where each acquisition came from (eBay, Facebook, Amazon, gift, etc.).

## v0.1.0 — 2026-04-28
- Initial public release. Roundhouse is a desktop catalog for model train collections.
- **Collections → Sets → Items** hierarchy with photo gallery per item.
- Full Items list with search, type/scale filters, and a running purchase total.
- SQLite backend with WAL mode, foreign keys, and `updated_at` triggers.
- Strict security posture: sandboxed renderer, context-isolated preload bridge, scoped `app://` photo protocol.
