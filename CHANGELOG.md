# Roundhouse Release Notes

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
