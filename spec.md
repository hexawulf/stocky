# Stocky — Specification (v1)

> Status: **v1 spec, decisions recorded (§12)**. Self-hosted on PocketBase (#14); hardware discovery (§13) built in phases D1–D3. Deployment: `docs/deploy.md`; seed presets: `docs/presets.md`.

## 1. Overview

Stocky is a mobile-first hardware stock manager: know what's in your machines, and what's in stock. Stock lives at physical **sites** (a new account starts with one, Home) and moves between them via **In transit**, e.g. in a suitcase. Parts can also be **installed** in a host, such as a server or a NAS. An installed part no longer counts as a spare. It started as a homelab tool for two sites; an example homelab with that shape is available as the opt-in `example` preset (§5.4).

Stack: Vue 3 (existing scaffold) + vue-router + **PocketBase** (email/password auth, SQLite database, API rules, realtime), self-hosted as one Docker container behind your own reverse proxy. No Firebase. Deployment: `docs/deploy.md`.

### Goals

- G1. Answer "do I have a spare X, and where is it?" in under 10 seconds on a phone.
- G2. Never retype a part: each part type is defined once, then reused for every stock entry.
- G3. Every change is a dated, permanent **movement**, so history answers "what happened and when?".
- G4. Flag anything at or below its low-stock threshold.
- G5. A user's data is private: each account sees only its own data.

### Non-goals

Stocky is not a network, service or monitoring tool. Cloud VPSes hold no physical stock and don't appear in the app.

## 2. Glossary

| Term         | Meaning                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Part**     | A _type_ of item in your catalog, e.g. "Samsung 990 EVO 1TB NVMe". Not an individual unit.                                         |
| **Location** | A place where _spare_ stock sits. Either a **site** (Lab, Office, any you add) or the single system location **In transit**. |
| **Host**     | A machine a part can be installed in. Every host belongs to one site.                                                              |
| **Category** | A grouping for parts (Storage, Power, …).                                                                                          |
| **Unit label** | The label a part is counted in (its `unit` field): `pcs`, `sheets` or `m`. Counts are always whole numbers.                      |
| **Unit**     | One individual item with a known serial number, recorded by hardware discovery (§13.4.3). Quantities stay the source of truth.     |
| **Import**   | One applied discovery snapshot from a host, with the movements it wrote; it can be undone as a whole (§13.4.4).                    |
| **Found installed** | A movement for something already in a host before Stocky knew about it: no source, spares unchanged (§13.4.1).             |
| **Spare**    | Stock at a location that isn't installed.                                                                                          |
| **Movement** | One dated event that changes quantities (stock in, stock out, move, install, uninstall, found installed).                         |
| **Undo**     | A _reversing movement_ that cancels your most recent movement within 24 h.                                                         |
| **Retire**   | Hide a site, host or category from pickers while keeping its history.                                                              |

Sites, hosts and categories are editable in the app (§4.10).

## 3. User stories

**Auth**

- US-1. As the owner, I log in with email and password, and see nothing until I do. There is no public sign-up; my account is created in the PocketBase dashboard.
- US-2. As the owner, I stay logged in on my phone between visits, and I can log out.

**Catalog**

- US-3. I add a new part with a name, category, unit, optional manufacturer/model, notes and low-stock threshold.
- US-4. I search my catalog by name, manufacturer or model, and filter by category.
- US-5. When I type a part name that already exists, I'm offered the existing part so I don't create a duplicate.
- US-6. I edit a part's details without affecting its history.
- US-7. I archive a part I no longer stock, which hides it from lists but keeps its history.

**Stock movements**

- US-8. I record a **stock in** (purchase) of N units of a part at a location, optionally with the unit price I paid in TWD, EUR or USD.
- US-9. I record a **stock out** (used / retired / discarded) of N units from a location.
- US-10. I **move** N units between locations, e.g. Lab → In transit → Office.
- US-11. I **install** N units into a host, e.g. one NVMe into pi-b, which removes them from spares.
- US-12. I **uninstall** N units from a host back to a location's spares.
- US-13. Each movement gets a date, which defaults to today and can be back-dated, plus an optional note (e.g. trip details).
- US-14. I **undo** my most recent movement within 24 hours. The undo is recorded as a reversing movement, so the history stays intact.

**Overview and history**

- US-15. My home screen shows spare quantities per site and in transit, and highlights low-stock parts.
- US-16. I see what's currently installed in each host.
- US-17. I see a part's full movement history, and a global history I can filter.

**Reference lists**

- US-18. I add and rename sites, hosts and categories. The lists start out seeded: by default with one site (Home), In transit and generic categories; with my homelab's lists if the operator chose that preset for my account (§5.4).
- US-19. I retire a site, host or category, which hides it from pickers but keeps its history. I can only hard-delete an entry that nothing has ever referenced.

## 4. Screens and flows (mobile-first)

**Layout decisions**

- Designed for a 360–430 px wide phone first: single column, tap targets of 44 px or more, primary actions in thumb reach.
- **Bottom navigation** (phone) with four tabs: **Home · Parts · ＋ Record · History**. A gear icon in the top bar opens **Settings** (§4.9); next to it, an **Import** button (tray icon + label) starts a discovery import from anywhere (§4.11), and an **About** button (ⓘ; the word "About" too from 768 px) opens the About dialog:
  - **About Stocky** with the tagline; the version (from `package.json` at build time, never written into the component) and the release month; the tech stack (backend, realtime, frontend, state, styling, testing, discovery, packaging); contact (author and a `mailto:` link); links to the repository, Docker Hub, the spec and the MIT licence (new tab, `rel="noopener noreferrer"`).
  - **Diagnostics:** one monospace line with **Copy**, e.g. "Stocky v0.1.0 · PocketBase 0.40.4 · schema 1791072010 · preset example · realtime connected · online". The PocketBase version and the newest applied migration come from `GET /api/stocky/about` (signed-in users only, so guests learn no versions; "unknown" when it can't be reached); the preset, realtime and online state come from the app.
  - A modal dialog (`role="dialog"`, `aria-modal`): focus moves to Close and stays inside (Tab and Shift+Tab wrap), Esc, Close or the backdrop close it, and focus returns to the button that opened it. A bottom sheet on phones, centred from 768 px.
- At 768 px and wider, the bottom nav becomes a left sidebar and content is centered (max width about 960 px). Part detail can show its info and history side by side.
- Reuse the existing theme tokens (`src/assets/base.css`) and button classes (`src/assets/main.css`), including dark mode.
- Quantities are always shown with the part's unit: "3 pcs", "2 sheets", "5 m". Exactly one reads singular: "1 pc", "1 sheet" ("1 m" stays). Only the display changes; the stored unit is always `pcs`, `sheets` or `m`.
- _Why bottom nav:_ thumb reach on a phone. The "＋ Record" tab is in the middle because recording a movement is the most frequent action.

**Global states (every screen)**

- **Loading:** skeleton rows, not a blank screen.
- **Offline:** a banner reads "Offline — showing last synced data. Changes are disabled until you reconnect." (§7.5 explains why writes are blocked.)
- **Permission denied / session expired:** sign out and send the user to Login with "Your session expired, please log in again". PocketBase treats an invalid or revoked token as a guest, so record lists come back **empty with 200** instead of 401 (verified on 0.40.4). The app therefore confirms the session (`authRefresh`) before it loads data and before reloading after a realtime reconnect, refreshes the token when it's within a day of expiring (checked every 10 minutes and when the tab becomes visible), and treats any 401 from a route as an ended session (`src/stores/auth.js`).
- **Unexpected error:** an inline message with a Retry button. Raw PocketBase error responses go to the console, never to the UI.

### 4.1 Auth gate (splash)

- On load, restore the saved PocketBase session (`pb.authStore`) and confirm it with `authRefresh()`, showing a centered logo spinner.
- Signed in → Home (after first-login seeding, §5.4). Signed out → Login.
- Every route except Login requires auth, enforced by a vue-router guard. _Why:_ the story says "nothing before login". PocketBase API rules enforce the same thing server-side (§6).

### 4.2 Login

- Email, password (with a show/hide toggle), and a **Log in** button. A "Forgot password?" link sends PocketBase's password-reset email (SMTP via the pi-b mail relay, §9.3).
- **No "Create account" link.** Accounts are created by hand in the PocketBase dashboard (see §9.2 for why hiding the link alone isn't a security boundary).
- **Errors:** wrong email or password shows one generic message ("Email or password is incorrect"), so the app doesn't reveal which accounts exist. Too many attempts shows "Too many attempts, try again later". Network failure shows "Can't reach the server".
- While submitting, the button is disabled with a spinner, which prevents double submits.

### 4.3 Home (dashboard)

- **Low stock card** at the top, only shown when something is flagged: parts whose total spares (all sites **plus** In transit) are ≤ threshold. Each row shows the total and the threshold, with the in-transit share shown separately, e.g. "2 pcs (1 in transit) · min 2". Tapping a row opens Part detail.
- **Location sections:** one per active site in your chosen order, then **In transit** as its own section. They appear as segmented tabs on phone, or as columns on desktop. Each section lists parts with spare qty > 0 at that location, grouped by category, with the quantity as a badge. The section header shows the location's total spare count.
- **Installed** section (collapsed by default): each active host, grouped by site, with the parts in it.
- **Empty states:**
  - No parts at all: an illustration, "Your catalog is empty", and an **Add your first part** button.
  - Parts exist but a site is empty: "Nothing spare in Office" with a **Record stock in** link.
  - In transit empty: "Nothing in transit" (no call to action; this is normal).

### 4.4 Parts (catalog and search)

- A search field at the top, autofocused when the tab opens from the ＋ flow. Category filter chips (active categories) sit below it. A toggle shows archived parts.
- Each row shows name, category, manufacturer/model, total spare quantity with unit, and a low-stock dot.
- A floating **＋ New part** button.
- Search is a case-insensitive substring match on name, manufacturer and model, filtered in memory (see §5.6).
- **Empty states:** with no parts, the same call to action as Home. With no results, "No parts match 'evo 2tb'" and an **Add "evo 2tb" as a new part** button that pre-fills the name.

### 4.5 Part detail

- Header: name, category chip, unit, manufacturer/model, notes, threshold.
- Quantity grid: spare count per site plus In transit, a total, and an "Installed in" list (host × qty).
- Action buttons: **Stock in · Move · Install · Uninstall · Stock out**. Actions that can't apply right now are disabled with a hint, e.g. Move is disabled when every location is 0 ("No spare stock to move").
- History: the 20 most recent movements for this part, plus "Show all". If the newest movement in the whole account belongs to this part and is undoable (§7.4), its row shows **Undo**.
- Overflow menu: **Edit**, **Archive / Unarchive**.
- **Errors:** if the part isn't found (a bad link), show "Part not found" with a link back to Parts.

### 4.6 Add / Edit part

- Fields: **Name\*** (2–80 chars), **Category\*** (select, active categories), **Unit\*** (pcs / sheets / m, default pcs), Manufacturer, Model, Notes (up to 500 chars), Low-stock threshold (whole number of 0 or more, blank for none).
- Optional for new parts only: "Initial stock" (quantity + location + date + optional price). This is the most common reason to add a part, and it creates a `stock_in` movement in the same transaction. _Why:_ it saves an extra screen for the usual first action.
- **Duplicate check:** if the name matches an existing part (case and whitespace-insensitive), show inline "You already have 'Samsung 990 EVO 1TB NVMe' — open it?" Saving a duplicate isn't allowed, because the name is the user's identifier.
- Changing the unit of a part that already has movements shows a warning ("Existing quantities will be shown in the new unit"), because counts aren't converted.
- **Errors:** field-level messages for required/length/number, and a toast with Retry if the save fails.

### 4.7 Record movement (＋ tab, and the Part detail actions)

- Step 1: **type** as segmented buttons, each with its icon: Stock in · Stock out · Move · Install · Uninstall · Found installed. Coming from Part detail pre-selects the type and the part. Found installed shows the hint "For hardware already in a host before Stocky knew about it. Spares aren't touched."

- Step 2: the fields change with the type:

| Type      | From                           | To                                                | Extra                                      |
| --------- | ------------------------------ | ------------------------------------------------- | ------------------------------------------ |
| Stock in  | —                              | Any active location                               | Optional unit price + currency (TWD / EUR / USD) |
| Stock out | Location, or a host it's installed in (§13.4.2) | —                                | Reason\*: used / retired / discarded       |
| Move      | Location                       | Another active location                           | —                                          |
| Install   | The host's site, or In transit | Active host                                       | —                                          |
| Uninstall | Host                           | Any active location (defaults to the host's site) | —                                          |
| Found installed | —                        | Active host ("Found in")                          | — (no price, no reason; §13.4.1)           |

- Common fields: **Part\*** (search picker, with "＋ new part" inline for Stock in and Found installed), **Quantity\*** (stepper, default 1), **Date\*** (date only, default today in the phone's time zone), Note.
- The picker for the "From" side shows what's available, e.g. "Lab (3 pcs available)"; for Stock out, hosts with the part installed follow under "Installed in", e.g. "pi-b (1 pc installed)". The quantity stepper's max is the available amount. For Install, the "To" host is chosen first, and "From" then offers only that host's site and In transit.
- Price: the currency defaults to the location's site default currency (e.g. USD for Lab, EUR for Office in the example preset); for In transit or a site without one, it's the last currency used on this device (kept in the browser's local storage, a per-device convenience). If there's neither, the currency starts empty and the user must pick one before a price can be saved. The price is typed in major units (euros or dollars, not cents; whole NT$ for TWD) and the field says so. Under it, the form reads the amount back as it will be saved ("= €200.00 each", plus "· €400.00 total" for more than one), so a slip like 20000 for €200.00 is visible before saving. _Why per unit:_ totals and later "value per site" can always be derived from it, but not the other way round once quantities change.
- A summary line before saving, e.g. "Move 2 × High-endurance microSD 128 GB from Lab → In transit on 2026-10-03". _Why:_ it catches wrong-direction mistakes, and history can't be edited (only the last movement can be undone, §7.4).
- **Errors:** "Only 1 pcs available at Lab" (validation), "Stock changed on another device, please review" (the server found a lower quantity), and the offline banner. On error the form keeps its values.
- **Success:** a toast saying "Recorded" with **Undo** and **View part** links. The form resets but keeps the type.

### 4.8 History

- Movements in reverse date order, grouped by day. Each row shows a type icon (a distinct shape and colour per type: spares in and out of a tray, installs in and out of a host, so Install never looks like Stock in), part name, quantity with unit, from → to, price if any, and the note.
- An undone movement is shown greyed with an "Undone" badge. Its reversing movement is shown as "Undo of: …". Both stay visible.
- The newest movement shows **Undo** while it's eligible (§7.4). Tapping it opens a confirm sheet that shows the reversal summary. Movements written by a discovery import don't get the single Undo; the import is undone as a whole (§13.4.4).
- **Imports:** a discovery import's consecutive rows on a day are one collapsed group, "Discovery import · pi-b · 3 movements" (plus ", 2 serials linked" when it attached serials without a movement), with an "Undone" badge once undone. While the import is still the newest thing recorded and under 24 h old, the group shows **Undo import**, which asks first: "Its 3 movements are reversed, serials it added are removed and what it learned is forgotten. Parts it created stay; archive them if you don't need them." A row lists the serials of the units it concerned ("S/N S5GX…"). An import that wrote **no movement but linked serials** still appears, at the top of its day ("Discovery import · pi-b · 0 movements, 2 serials linked", "No quantities changed: serials were linked to parts already recorded in this host.") with the same Undo import; it's hidden while a type or part filter is set, and shown for its host and date range.
- Filters: type, location/host, part, and date range. Retired sites and hosts still appear in the filters, marked "(retired)". Filters run **on the server** as PocketBase filters (§5.2), so every page of 50 already matches; a place filter matches a movement whose `fromLocation`, `fromHost`, `toLocation` or `toHost` is that place.
- Infinite scroll loads 50 at a time using PocketBase paged lists (`getList`, 50 per page).
- **Empty states:** "No movements yet", or with filters active, "No movements match these filters" plus **Clear filters**.
- **Undo errors:** "Can't undo — a newer movement was recorded", "The 24-hour undo window has passed", "This movement was already undone".

### 4.9 Settings

- **Account:** email and **Log out**.
- Links to **Sites**, **Hosts** and **Categories** (§4.10).
- **About Stocky:** opens the About dialog (§4).

### 4.10 Manage sites, hosts and categories

One list screen per type, with the same pattern on each:

- Active entries in sort order (drag handle or up/down buttons), then a collapsed "Retired" group.
- **＋ Add** opens a small form:
  - Site: label, optional default currency (TWD / EUR / USD; it pre-selects the price currency for a stock in there, §4.7).
  - Host: label, type (free text, e.g. "Raspberry Pi 5 (8 GB)"), site\* (active sites only).
  - Category: label, optional description (e.g. "NVMe, microSD, HDD").
- Each row's menu has **Rename / Edit**, **Retire** (or **Unretire**), and **Delete** (only shown when the entry has never been referenced, §5.3).
- **In transit** appears in the Sites screen as a system entry that can be renamed but not retired or deleted.
- **Hosts** also have an **Import** link (§4.11) and, once imported, the line "Last import Sun, 5 Oct 2026 · stocky-collect 1.0.0" (the newest import that wasn't undone).
- **Retire guards (errors shown inline):**
  - Site: "Can't retire Lab — 7 parts still have spare stock there. Move or stock them out first." A site also can't be retired while it has active hosts ("Retire or move pi-a, pi-b… first").
  - Host: "Can't retire pi-b — 2 parts are installed in it. Uninstall them first."
  - Category: always allowed. Parts keep the category and show it as "Storage (retired)". It's hidden when creating new parts.
- **Empty state:** "No hosts yet" with **＋ Add host** (only if you delete all the seeded hosts).
- Labels must be unique within each list among active entries ("A site named Lab already exists").

### 4.11 Import discovery (top bar → Import, or Settings → Hosts → Import)

Two entries to the same screen (spec §13.3):

- **Top bar → Import** (`/import`): the file comes first. Once it reads as a snapshot, "Import for host" suggests the host: a previous import of the same machine (`machineIdHash`) first, since that survives a rename, then a host whose name or key matches the snapshot's hostname (ignoring case, spaces, dots, dashes, underscores), with the reason shown. A host picked by hand stays picked. With no match: "No host matches “…”. Pick one, or add it", and **＋ Add host** opens a small form pre-filled with the hostname (name), the machine's model (type) and the first site. Preview needs a host. After applying, History opens filtered to that host.
- **Settings → Hosts → Import** (`/settings/hosts/:id/import`): for that host, as before; after applying, back to Hosts.

The steps:

1. **Upload:** the collector command to run on that host (`stocky-collect.sh -o pi-b.json`), a file picker and a paste box. The browser checks the text first (not empty, at most 256 KB, valid JSON, `schema` is `stocky.discovery/1`, not `virtual`) and shows the same messages as the server: "That file isn't valid JSON", "Unsupported snapshot format (expected stocky.discovery/1)", …
2. **Preview** (the server proposes; nothing is written):
   - A line about the snapshot ("From pi-b (Raspberry Pi 5 Model B Rev 1.0) · stocky-collect 1.0.0 · 9 items · collected …"), the host's last import, and the collector's `warnings`, `skipped` parts and items left out, in a highlighted box.
   - Rows grouped **Unchanged · Serial added · Conflict · New · Missing · Replaced · Moved · Ignored**, each group with a one-line explanation.
   - **Conflict** rows (§13.11.10) say "Recorded here: Ryzen 7 5700X3D · detected: AMD Ryzen 7 5700G …" and default to "Keep what is recorded (leave this one out)"; the other choices are "Replace: uninstall the recorded one, keep it as a spare" (with where) and "Replace: the recorded one is gone (stock out)" (with a reason), which then ask for the detected item's part.
   - Rows **declined on an earlier import** (§13.11.9) wait under Ignored, unchecked, with "You left this out before. Check it to import it after all." Each row shows what was detected (raw vendor and model, size, interface, slot, serial), how it matched ("Matched by serial", "… by an earlier import", "… by manufacturer + model", or "New part"; "no serial: matched by count only"), and its quantity with the unit label. A Replaced pair is shown as one block, "Out:" then "In:".
   - Every row except Unchanged and Ignored has a checkbox, preset as §13.11.5 says. A checked row shows its decision: for a new part, its name, category and unit (or **Is this …?** buttons to use an existing part instead); "What happened" when there's a choice (found installed / installed from spares at …; uninstall and keep at … / gone, with a reason / ignore this time). Checking a row that defaults to "ignore this time" switches it to its first real action.
   - The **Not detectable** panel (§13.8), with a link to Record → Found installed for this host (`/record?type=found_installed&host=<id>`).
   - Strings from the snapshot are always shown as text, never interpreted as markup.
3. **Apply N changes** (or "Confirm (nothing to change)" when only "last seen" dates move) sends the decisions with the preview's hash. Success: back to Hosts with the toast "Imported for pi-b: 3 movements" and a **History** link filtered to that host. If anything changed since the preview: "Your inventory changed since this preview; review it again", Apply is disabled, and **Review again** re-runs the preview. A row the server refuses is named ("Pick a category (row 4)"). **Start over** returns to the upload.

## 5. Data model

Stocky stores everything in **PocketBase** (SQLite). Collections, fields, indexes and API rules are defined as JS migrations in `pb_migrations/` (§9.1).

### 5.1 Scoping: one `user` relation on every record

```
users          auth collection (+ seedVersion, lastMovementId)
locations      sites + the In transit location
hosts
categories
parts          catalog + current stored totals
movements      append-only history
```

Every collection except `users` has a required **`user`** relation to `users`, plus an index on `user`. Every API rule starts from `user = @request.auth.id` (§6).

_Why flat collections:_ PocketBase has no subcollections, so the Firestore path scoping (`users/{uid}/…`) doesn't carry over. A `user` field checked by the same rule on every collection gives the same guarantee. List, view and realtime all apply that rule on the server, so a query can't return someone else's data even if the client forgets a filter.

### 5.2 Collections

Field types are PocketBase field types. `created` and `updated` are **autodate** fields (server time). Record IDs are PocketBase's generated 15-character IDs. Every reference to another record is a **relation**, never a label.

**`users`** (auth collection; email and password are built in)

| Field            | Type                           | Notes                                                     |
| ---------------- | ------------------------------ | --------------------------------------------------------- |
| `seedVersion`    | number (int)                   | `0` until the reference lists are seeded, then `1` (§5.4) |
| `seedPreset`     | text, optional                 | a preset name (`standard`, `example`, or one from `stocky-presets.json`); empty means `standard`. Set by the superuser when creating the account; read once by the seed route (§5.4) |
| `lastMovementId` | relation → movements, optional | the newest movement in the account; drives Undo (§7.4)    |
| `created`        | autodate                       | server time                                               |

Only the server (routes in `pb_hooks`) writes `seedVersion` and `lastMovementId`.

**`locations`**

| Field                | Type             | Notes                                                                                   |
| -------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `user`               | relation → users | owner                                                                                   |
| `key`                | text, optional   | seed key, e.g. `lab`, `in_transit` (§5.4); empty for entries you add                 |
| `label`              | text             | 1–40 chars, e.g. "Lab"                                                               |
| `kind`               | select           | `site` \| `transit`; can't be changed; exactly one `transit` per user                   |
| `sortOrder`          | number (int)     | display order                                                                           |
| `defaultCurrency`    | select, optional | `TWD` \| `EUR` \| `USD`; pre-selects the price currency for stock in (§4.7)          |
| `retired`            | bool             | always `false` for `transit`                                                            |
| `referenced`         | bool             | set to `true` the first time a movement or host uses it; once true, it can't be deleted |
| `created`, `updated` | autodate         | server time                                                                             |

**`hosts`**

| Field                                                      | Type                 | Notes                        |
| ---------------------------------------------------------- | -------------------- | ---------------------------- |
| `user`, `key`                                              |                      | as for locations             |
| `label`                                                    | text                 | 1–40 chars, e.g. "nas-a"    |
| `type`                                                     | text, optional       | e.g. "Synology NAS"          |
| `site`                                                     | relation → locations | a location with `kind: site` |
| `sortOrder`, `retired`, `referenced`, `created`, `updated` |                      | as for locations             |

Hosts also have **`discoveryIgnored`** (json array): keys of detected items the user declined on an import, `S:<serialKey>` or `M:<kind>|<model key>` (§13.11.9); written only by the discovery routes.

**`categories`**

| Field                                                      | Type           | Notes                                                           |
| ---------------------------------------------------------- | -------------- | --------------------------------------------------------------- |
| `user`, `key`                                              |                | as for locations                                                |
| `label`                                                    | text           | 1–40 chars                                                      |
| `description`                                              | text, optional | e.g. "NVMe, microSD, HDD"                                       |
| `sortOrder`, `retired`, `referenced`, `created`, `updated` |                | as for locations; `referenced` becomes true when a part uses it |

**`parts`**

| Field                | Type                   | Notes                                                                                |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `user`               | relation → users       | owner                                                                                |
| `name`               | text                   | 2–80 chars, trimmed                                                                  |
| `nameKey`            | text                   | `name` lowercased, whitespace collapsed; set by the server; unique per user          |
| `category`           | relation → categories  |                                                                                      |
| `unit`               | select                 | `pcs` \| `sheets` \| `m`                                                             |
| `manufacturer`       | text, optional         | up to 60 chars, e.g. "Samsung"                                                       |
| `model`              | text, optional         | up to 60 chars, e.g. "MZ-V9E1T0"                                                     |
| `notes`              | text, optional         | up to 500 chars                                                                      |
| `lowStockEnabled`    | bool                   | false means no alert                                                                 |
| `lowStockThreshold`  | number (int)           | 0–9,999; only used when `lowStockEnabled` is true                                    |
| `spare`              | json                   | `{ <locationId>: int }`, e.g. `{ "<lab id>": 2, "<in_transit id>": 1 }`           |
| `installed`          | json                   | `{ <hostId>: int }`; zero entries may be removed                                     |
| `spareTotal`         | number (int)           | sum of all `spare` values **including In transit**; makes "low stock" one comparison |
| `archived`           | bool                   | default false                                                                        |
| `created`, `updated` | autodate               | server time                                                                          |

`parts` also has **`matchKeys`** (json array of strings): the collector model strings this part has learned to recognise (§13.5), written only by the discovery routes.

`spare`, `installed` and `spareTotal` are written only by the movement routes (§7.3). PocketBase number fields can't be empty (an unset number is 0), so a blank threshold in the form (§4.6, §8) is stored as `lowStockEnabled: false`, and a part is low on stock when `lowStockEnabled && spareTotal <= lowStockThreshold`.

**`movements`**

| Field           | Type                           | Notes                                                                   |
| --------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `user`          | relation → users               | owner                                                                   |
| `part`          | relation → parts               |                                                                         |
| `type`          | select                         | `stock_in` \| `stock_out` \| `move` \| `install` \| `uninstall` \| `found_installed` |
| `quantity`      | number (int)                   | 1–9,999                                                                 |
| `fromLocation`  | relation → locations, optional | set for stock_out (from a location), move, install                      |
| `fromHost`      | relation → hosts, optional     | set for uninstall, and stock_out from a host                            |
| `toLocation`    | relation → locations, optional | set for stock_in, move, uninstall                                       |
| `toHost`        | relation → hosts, optional     | set for install, found_installed                                        |
| `reason`        | select, optional               | stock_out only: `used` \| `retired` \| `discarded`; empty on a reversal |
| `priceMinor`    | number (int), optional         | stock_in only; **unit** price in the currency's minor unit              |
| `priceCurrency` | select, optional               | `TWD` \| `EUR` \| `USD`; **empty means no price** (then `priceMinor` is ignored) |
| `date`          | text, pattern `YYYY-MM-DD`     | the day it happened in the phone's time zone                            |
| `note`          | text, optional                 | up to 500 chars (trip details, which box, …)                            |
| `reverses`      | relation → movements, optional | set on an undo: the movement it cancels                                 |
| `units`         | relation → units, multiple     | the serialised units it concerned (§13.4.3); set by the server only     |
| `import`        | relation → imports, optional   | the discovery import that wrote it (§13.4.4)                            |
| `created`       | autodate                       | server time, when it was recorded                                       |

Each side of a movement has exactly one of its two relations set, or none (`from` is empty for stock_in and found_installed, `to` for stock_out), matching the §4.7 table.

_Why four relations instead of a `{ kind, id }` object:_ relations are checked by PocketBase (the target must exist), they can be expanded for display, and a referenced location or host can't be deleted out from under history.

_Why `date` is a string:_ the movement has a date but no time, and it's entered in whichever time zone the phone is in. A datetime field stores an exact instant. "2026-10-03 00:00 in Lab" is still 2 October in Germany, so an instant would show the wrong day after you fly. A `YYYY-MM-DD` string means the same day everywhere, and it still sorts correctly as text.

_Why both `date` and `created`:_ `date` is when it happened in real life, and `created` is when you typed it in. Back-dating a purchase you forgot to log changes only `date`. `created` also gives a stable order for movements on the same day, and it's what the 24-hour undo window is measured from.

_Why `priceMinor` (an integer):_ floating-point numbers can't store 12.99 exactly, and repeated sums drift. Amounts are stored as integers in the currency's smallest unit used here: **EUR and USD in cents** (€12.99 → `1299`) and **TWD in whole dollars** (NT$1,290 → `1290`, because TWD is priced without cents in practice). The app keeps that per-currency exponent (EUR 2, USD 2, TWD 0) in one helper used for input and display. There's no conversion between currencies in v1.

_Why no `partName` snapshot:_ nothing that a movement references is ever hard-deleted (parts are archived; sites, hosts and categories are retired). So history can always look up the **current** name, and a renamed part reads consistently everywhere.

_Why `spare` and `installed` are json fields, not rows:_ every quantity write already goes through one server route (§7.3), Home and search read only `parts`, and one movement changes one part record, which is one realtime event. The server-side checks that need "what's at this location?" (the retire guards, §6) scan the user's parts, which is cheap at hundreds of parts. A separate `stock` collection (part × location rows) would only pay off for querying stock by location on the server. Revisit together with §5.6 at roughly 5,000 parts.

**`units`** (hardware discovery, §13.4.3; written only by the discovery and movement routes)

| Field                    | Type                           | Notes                                                                         |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------------------- |
| `user`, `part`           | relations                      | owner; which part it's a unit of                                              |
| `serial`                 | text                           | as reported, up to 80 chars                                                   |
| `serialKey`              | text                           | upper-cased, spaces and dashes removed; unique per `(user, part, serialKey)`  |
| `kind`, `slot`           | text                           | what the collector called it and where (`nvme0`, `DIMM A`), for Replaced      |
| `host` / `location`      | relations, optional            | where it's installed / where it sits as a spare                               |
| `status`                 | select                         | `installed` \| `spare` \| `gone`                                              |
| `firstSeen`, `lastSeen`  | text `YYYY-MM-DD`              | from snapshots                                                                |
| `lastImport`             | relation → imports, optional   | the import that last confirmed it                                             |
| `created`, `updated`     | autodate                       |                                                                               |

**Units follow movements.** A movement's units go where it goes: installed in its `toHost`, spare at its `toLocation`, or `gone` when it has no destination. When a movement recorded by hand (Record never names units) leaves fewer items at its source than units recorded there, the server moves the excess units with it, least recently seen first, and lists them in the movement's `units`; undoing it brings the same units back. So a part's units never outnumber its quantity at any host or location (the consistency rule, §8).

**`imports`** (§13.4.4; written only by the discovery routes)

| Field                                  | Type                         | Notes                                                                     |
| -------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `user`, `host`                         | relations                    | owner; the host it was imported for                                       |
| `collectedAt`, `collector`, `hostname`, `machineIdHash` | text        | from the snapshot                                                         |
| `snapshot`                             | json                         | the validated snapshot (§13.3.2), up to 400 KB                            |
| `summary`                              | json                         | applied rows per group, e.g. `{ "new": 3, "replaced": 2 }`, plus `serialsLinked` (units attached without a movement) |
| `movements`                            | relation → movements, multiple | what it wrote, in order (undo reverses them in the opposite order)      |
| `unitsBefore`                          | json                         | the prior state of every unit it changed; `null` for units it created     |
| `mappingsAdded`                        | json                         | `[{ part, key }]`: the `matchKeys` it added                               |
| `lastMovementAfter`                    | text                         | `users.lastMovementId` right after the apply; undo needs it unchanged     |
| `undone`                               | bool                         |                                                                           |
| `ignoredBefore`                        | json                         | the host's `discoveryIgnored` before this import changed it (null if it didn't); undo restores it |
| `created`, `updated`                   | autodate                     |                                                                           |

**Indexes:** `movements (user, part, date, created)` for Part detail history; `movements (user, date, created)` for History; unique `parts (user, nameKey)`; unique `(user, key)` on locations, hosts and categories for non-empty `key`; `movements (import)`; `units (user, part)`, `units (user, serialKey)` and unique `units (user, part, serialKey)`; `imports (user, host, created)`. History's filters (type, part, date range, place) are sent to PocketBase as list filters, combined with `user` and sorted `-date,-created`; a place filter is an OR over `fromLocation`, `fromHost`, `toLocation` and `toHost`. _Why on the server:_ filtering in memory over 50-row pages shows half-empty pages and "no results" while matches still sit on later pages. Because a filter can hide a reversal row, each loaded page also asks for the movements that reverse it (`reverses` in that page's IDs), so "Undone" still shows (§4.8).

### 5.3 Reference lists: editable, retire instead of delete

- Sites, hosts and categories are records the user owns and edits (§4.10). Every record that points at one stores a **relation** (its ID), never the label, so renaming is a single update.
- **Retire** sets `retired: true`. Retired entries are hidden from pickers but still resolve in history, filters and existing parts.
- **Hard delete** is allowed only when `referenced == false`. _Why a flag, not a lookup:_ to check "is anything using this host?" you'd have to search every movement, including old ones. Setting `referenced: true` the first time something uses an entry makes the check one field, which the delete rule can test directly (§6). It's never reset to false.
  - A location becomes referenced when a movement uses it or a host is assigned to it. A host becomes referenced when a movement uses it. A category becomes referenced when a part uses it. The server sets the flag (§6, §7.3); the client can't.
- Seeded entries start with `referenced: false`, so you can delete seeded ones you never use.

### 5.4 Seed data (written on first login)

After the first successful login, the auth gate (§4.1) sees `seedVersion == 0` and calls **`POST /api/stocky/seed`**. In one transaction, that route re-reads `seedVersion`, returns without writing if it's already `1`, and otherwise creates the lists of the account's **preset** and sets `seedVersion: 1`. _Why a server route:_ a retried or doubled call (two tabs, a dropped response) can't create duplicates, because the check and the writes are in the same transaction.

Seeded records get normal generated IDs. Each one also gets a fixed **`key`** (e.g. `home`, `in_transit`), unique per user. _Why not fixed IDs:_ PocketBase record IDs are 15 characters and unique across the whole collection, not per user, so `home` can't be every user's ID. The `key` gives the seed and the code a stable name to look entries up by. Entries you add later have no key.

**Required index:** `locations`, `hosts` and `categories` each get a **unique index on `(user, key)`, limited to non-empty `key`** (`WHERE key != ''`), created in `pb_migrations/`. It's the database-level guarantee that a user can't end up with two `home` records, even if the seed route's `seedVersion` check is ever bypassed or broken.

**Presets.** Every account seeds from one preset, chosen by the `users.seedPreset` field (§5.2):

| `seedPreset`           | What a new account starts with                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| empty or `standard`    | **the default for everyone:** one site, Home; In transit; generic categories; **no hosts**         |
| `example`              | opt-in: an example homelab (sites Lab and Office, In transit, eight hosts, homelab categories)     |
| a name from the file   | your own presets in `<pb_data>/stocky-presets.json` (`docs/presets.md`)                             |

- **Who chooses:** the superuser, when creating the account in the dashboard (§9.2): leave `seedPreset` empty for the standard lists, or enter a preset name. Users can't change it themselves (`users.updateRule = null`, §6.4). _Why a field and not a setup screen or an environment variable:_ accounts are already created by hand in the dashboard, so the choice belongs there; it needs no extra screen, and the image stays free of configuration (decision #15).
- **Only before the first login:** the preset is read once, when seeding runs. Changing it later does nothing to an account that's already seeded; its lists are edited in the app (§4.10).
- **`seedPreset` must be set before the account's first login;** otherwise the account gets `standard` permanently.
- **Where presets live:** `standard` and `example` are built in (`pb_hooks/lib/presets.js`). Your own go in `<pb_data>/stocky-presets.json`, read whenever a preset is needed, so adding one needs no rebuild or migration (decision #27). The file is validated on every read (keys, labels, exactly one transit location, hosts on sites of the same preset; `docs/presets.md`); an invalid file is ignored as a whole, with the reason logged, and the built-ins keep working. A file can't replace `standard` or `example`.
- `seedPreset` is a text field; a server hook refuses a name that isn't a preset now (`unknown_preset`). If a preset disappears from the file before the account's first login, the seed route refuses with the same code and seeds nothing.

**`standard` preset** (the default):

- **Locations:**

| key          | Label      | Kind    | Default currency |
| ------------ | ---------- | ------- | ---------------- |
| `home`       | Home       | site    | —                |
| `in_transit` | In transit | transit | —                |

  Home has no default currency, so a stock in there starts with the last currency used (§4.7). `home` starts unreferenced, so a user who renames or replaces it can also delete it while it's unused.

- **Hosts:** none. Users add the machines they have (§4.10).
- **Categories:** `computers` Computers & boards (SBCs, mini PCs, laptops) · `components` Components (CPUs, RAM, expansion cards) · `storage` Storage (SSDs, HDDs, memory cards) · `networking` Networking (switches, routers, access points) · `power` Power (PSUs, chargers, power cables) · `cables` Cables & adapters · `peripherals` Peripherals (displays, keyboards, cameras) · `consumables` Consumables (thermal paste, batteries, cable ties) · `other` Other.

**`example` preset** (opt-in):

- **Locations:**

| key          | Label      | Kind    | Default currency |
| ------------ | ---------- | ------- | ---------------- |
| `lab`        | Lab        | site    | USD              |
| `office`     | Office     | site    | EUR              |
| `in_transit` | In transit | transit | —                |

- **Hosts:**

| key           | Label       | Type                   | Site   |
| ------------- | ----------- | ---------------------- | ------ |
| `pi_a`        | pi-a        | Raspberry Pi 5 (16 GB) | lab    |
| `pi_b`        | pi-b        | Raspberry Pi 5 (8 GB)  | lab    |
| `workstation` | workstation | Desktop PC             | lab    |
| `nas_a`       | nas-a       | NAS                    | lab    |
| `router_a`    | router-a    | Router                 | lab    |
| `nas_b`       | nas-b       | NAS                    | office |
| `minipc`      | minipc      | Mini PC                | office |
| `router_b`    | router-b    | Router                 | office |

- **Categories:** `sbc` SBCs · `storage` Storage (NVMe, microSD, HDD) · `power` Power (PSUs, cables) · `networking` Networking (Ethernet cables, switches) · `cameras` Cameras · `sensors` Sensors (Zigbee) · `consumables` Consumables (thermal pads, batteries) · `other` Other.

Seeding hosts marks `lab` and `office` as `referenced: true`, because hosts point at them. (In general: a seeded site starts referenced exactly when the preset gives it hosts.)

### 5.5 Example data

IDs are shown as `<key>` for readability; real records use generated IDs.

```
parts/abc  { name: "High-endurance microSD 128 GB", category: <storage>, unit: "pcs",
             lowStockEnabled: true, lowStockThreshold: 2, spare: { <lab>: 3, <office>: 1, <in_transit>: 0 },
             installed: { <pi_a>: 1 }, spareTotal: 4 }
movements/m1 { type: "stock_in", part: "abc", quantity: 5, toLocation: <lab>,
               priceMinor: 590, priceCurrency: "TWD", date: "2026-09-12" }
movements/m2 { type: "install", part: "abc", quantity: 1, fromLocation: <lab>, toHost: <pi_a>, date: "2026-09-14" }
movements/m3 { type: "move",    part: "abc", quantity: 1, fromLocation: <lab>, toLocation: <in_transit>,
               date: "2026-09-28", note: "TPE→HAM flight, blue Pelican case" }
movements/m4 { type: "move",    part: "abc", quantity: 1, fromLocation: <in_transit>, toLocation: <office>, date: "2026-09-30" }
```

Other seed parts for development (local PocketBase only, not written to production): Raspberry Pi 5 16 GB, NVMe SSD 512 GB (Pi HAT), Raspberry Pi 27W USB-C PSU, Cat6 patch cable 1 m, Tapo C230 camera, Aqara Zigbee temperature sensor, CR2032 battery, thermal pad 1 mm (`sheets`).

### 5.6 Search and live data

PocketBase's filters can't do the instant, as-you-type search the Parts tab needs. A personal catalog stays small (hundreds of parts), so the app loads **parts, locations, hosts and categories once with `getFullList()`**, then keeps them current with **`subscribe('*')`** on each collection (realtime over server-sent events), and searches and filters in memory. Realtime events are checked against each collection's list rule, so you only receive your own records. _Trade-off:_ one full load per session, then only changed records. That's cheap at this scale, it makes search instant, and every screen and picker can share the same data. It would need rethinking past roughly 5,000 parts. Movements are **not** loaded all at once; they're paginated with `getList(page, 50, { sort: '-date,-created' })` (§4.8).

## 6. Security rules (plain language)

Access control is PocketBase **API rules** (one per action, per collection), plus **server hooks** in `pb_hooks` for checks a rule expression can't make. A rule set to `null` means "superusers only", so the app's API refuses that action outright. Field constraints (lengths, int ranges, select values, the `YYYY-MM-DD` pattern, required fields) are set on the collection fields themselves and apply to every write, including the server's own.

1. **Must be logged in.** Every rule requires `@request.auth.id != ""`; there's no public access.
2. **Only your own records.** List and view on every collection require `user = @request.auth.id` (on `users`: `id = @request.auth.id`). This also scopes realtime events (§5.6).
3. **Deny by default.** Every action not opened below is `null`.
4. **No sign-up, no self-editing.** Deleting a user (superuser only) removes all of their records: a `users` delete hook deletes movements, units, imports, parts, hosts, categories and locations in that order, in the same transaction as the user delete, because the history links (movement → part/location/host, host → site, part → category) deliberately don't cascade. If any step fails, nothing is deleted. `users` has `createRule = null`, so nobody can create an account through the API, even with a crafted request. `updateRule` and `deleteRule` are `null` too: account changes happen in the dashboard, and only the server writes `seedVersion` and `lastMovementId`. Password reset uses PocketBase's own reset endpoints and isn't affected by these rules.
   - **Password reset needs SMTP.** The reset link is sent by email. Without SMTP configured in the dashboard (Settings → Mail settings), PocketBase falls back to the system `sendmail` command, which the Stocky image doesn't include, so no mail is sent. The request still answers with success, so as not to reveal which accounts exist, and the failure only shows in the server log. Until SMTP is set up (§9.3, the pi-b mail relay), **password reset is dashboard-only**: the superuser sets a new password on the user record at `/_/`.
5. **Locations / hosts / categories:** create only with `user` set to yourself and without `referenced` or `key`; a location created through the API must be a `site` (In transit only comes from the seed). Update only your own, without changing `user`, `kind`, `key`, `referenced` or a host's `discoveryIgnored`; In transit can't be retired. **Delete only when the stored `referenced` is false**, and never In transit. A host's `site` must be one of your own `site` locations: the rule checks it through the relation (`@request.body.site.user = @request.auth.id && @request.body.site.kind = "site"`). Labels are unique per user among active entries, case-insensitively, through a unique index on `(user, label COLLATE NOCASE) WHERE retired = FALSE`, so no hook is needed for it. Server hooks additionally:
   - reject a host whose `site` is retired, and mark that site `referenced`;
   - enforce the retire guards (§4.10, §8): a site needs no spare stock and no active hosts, a host needs nothing installed, and In transit can never be retired.
   - **How the stock checks work:** stock isn't stored in its own collection, so retire **and** delete checks for a location or host **scan the user's parts' JSON stock maps**. A location is in use if any part has a non-zero `spare[<locationId>]`; a host is in use if any part has a non-zero `installed[<hostId>]`. The hook reads the user's parts and checks the maps in code, because API rule filters can't query keys inside a JSON field reliably. On delete this runs in an `onRecordDeleteRequest` hook as well as the `referenced = false` rule. In normal use `referenced` already covers it (stock can only get somewhere through a movement, which sets the flag), but the scan stops a corrupted flag from deleting a place that still holds stock.
6. **Parts:** create and update only your own, without setting `spare`, `installed` or `spareTotal` (the movement routes own those), `nameKey` or `matchKeys` (the discovery routes own those), and without changing `user`. `category` must be one of your categories, checked in the rule through the relation (`@request.body.category.user = @request.auth.id`). A server hook computes `nameKey` (the unique `(user, nameKey)` index rejects a duplicate name), checks that a new or changed `category` isn't retired, and marks it `referenced`. **No deletes** (archive instead), so history never points at a missing part.
7. **Movements are append-only, and only the server writes them:** create, update and delete are all `null`. Movements are recorded through `POST /api/stocky/movements` and undone through `POST /api/stocky/movements/{id}/undo` (§7.3–§7.4). Both require auth and run the full §8 validation on the server, including:
   - `type` is one of the six values, and `quantity` is an int from 1 to 9,999.
   - The `from`/`to` relations have the right shape for the type (§4.7 table), and each one belongs to you.
   - `reason` is required for `stock_out`, unless it's a reversal.
   - Price is only allowed on `stock_in`: none, or `priceMinor` an int from 0 to 99,999,999 with `priceCurrency` TWD, EUR or USD.
   - `date` matches `YYYY-MM-DD`.
   - An undo is only accepted when the movement is eligible (§7.4), and the 24 h is measured from its server-set `created`, so a client clock can't fake the window.
   - `units` can't be sent by the client: only discovery names units (§13.4.3).
8. **Units and imports are written only by the server:** create, update and delete are `null`; list and view are your own. The discovery routes (§13.3, §7.7) write them inside the same transactions as their movements.

| Collection                         | list / view               | create                              | update                                  | delete                                          |
| ---------------------------------- | ------------------------- | ----------------------------------- | --------------------------------------- | ----------------------------------------------- |
| `users`                            | `id = @request.auth.id`   | `null`                              | `null`                                  | `null`                                          |
| `locations`, `hosts`, `categories` | `user = @request.auth.id` | owner, no `referenced` (+ hooks)    | owner, protected fields unset (+ hooks) | `user = @request.auth.id && referenced = false` (+ stock-scan hook) |
| `parts`                            | `user = @request.auth.id` | owner, no quantity fields (+ hooks) | owner, no quantity fields (+ hooks)     | `null`                                          |
| `movements`                        | `user = @request.auth.id` | `null` (route only)                 | `null`                                  | `null`                                          |
| `units`, `imports`                 | `user = @request.auth.id` | `null` (routes only)                | `null`                                  | `null`                                          |

_What the server doesn't guarantee in v1:_ that a movement's date isn't in the future in **your** time zone. The server doesn't know the phone's time zone, so it only rejects dates later than tomorrow in UTC (time zones run up to UTC+14, so "today" somewhere can already be tomorrow in UTC), and the form checks the phone's today (§8). Everything the old Firestore design left to the client (a movement and its part totals being written together and adding up, the undo window) is now enforced on the server.

The API rules and hooks are tested against a **throwaway PocketBase** before release (§9.1).

## 7. How quantities are computed

### 7.1 Options considered

|                | A. Derived only                                   | B. Stored totals only                 | **C. Movements + stored totals (chosen)**                                    |
| -------------- | ------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| How it works   | Add up all movements whenever you need a quantity | Keep counters on the part, no history | Append a movement **and** update the counters on the part in one transaction |
| Reads for Home | Every movement ever (grows forever)               | 1 per part                            | 1 per part                                                                   |
| History        | ✅                                                | ❌ (breaks G3)                        | ✅                                                                           |
| Risk           | Slow/expensive as history grows                   | Can't explain numbers                 | Totals could drift from history if written incorrectly                       |
| Offline writes | ✅                                                | ✅                                    | ❌ (the transaction runs on the server)                                      |

### 7.2 Why C

Home and search read only the parts collection, with one small record per part. History stays the audit trail. Denormalize for reads, and keep the two in step with one server-side transaction. Because only the server writes quantities, the "could drift" risk is limited to bugs in one route, and §7.6 can detect it.

### 7.3 Write algorithm (every movement)

`POST /api/stocky/movements` (auth required) runs everything inside **`$app.runInTransaction`**:

1. Read the part, the user record, and the location/host records the movement touches (all fresh, inside the transaction). If the request carries `newPart` instead of `part` (§4.6 "Initial stock", or a found installed), validate and create the part first, in the same transaction.
2. Validate against **current** totals and the current state of those records (§8): e.g. everything belongs to the user, the location isn't retired, and there's enough stock. If invalid, throw a 400 with a friendly message; nothing is written.
3. Compute the new `spare`, `installed` and `spareTotal`.
4. Save the new movement and the updated part. Move the movement's units (§5.2 "Units follow movements") and check the consistency rule at every place it touched. Set `referenced: true` on any touched location/host where it was false. Set the user's `lastMovementId` to the new movement's ID.

The response returns the movement and the updated part. Other open devices get the changes through realtime (§5.6).

_Why a server route:_ the server is the only place that can check quantities and write the movement and totals together. SQLite runs write transactions one at a time, so two devices recording at once can't both pass step 2 on the same stock; the second sees the first's result. When the client's view was stale, the error reads "Stock changed on another device, please review" (§4.7). PocketBase's batch API (`pb.createBatch()`) is transactional too, but it can't validate quantities on the server, so it's only a fallback.

### 7.4 Undo (reversing movement)

**Eligible** when all of these are true:

- The movement is the account's newest: its ID equals the user's `lastMovementId`.
- It isn't itself a reversal (`reverses` is empty).
- Its `created` is less than 24 h ago.
- It wasn't written by a discovery import (those are undone together, §13.4.4).

**Reversal mapping:**

| Original           | Reversal           |
| ------------------ | ------------------ |
| stock_in N → L     | stock_out N from L |
| stock_out N from L | stock_in N → L     |
| move N A → B       | move N B → A       |
| install N L → H    | uninstall N H → L  |
| uninstall N H → L  | install N L → H    |
| found_installed N → H | stock_out N from H |
| stock_out N from H | found_installed N → H |

A reversal carries the original's `units` back with it.

`POST /api/stocky/movements/{id}/undo` checks eligibility on the server, with the server's clock, inside the same kind of transaction as §7.3. The reversal copies `part` and `quantity`, sets `reverses`, uses today's `date`, has `reason` and the price empty, and has the note "Undo of <original date> <type>". Because the reversal then becomes `lastMovementId` and reversals aren't undoable, you can't undo twice, and you can't undo an undo.

_Why a `lastMovementId` pointer:_ the client needs to know which row shows **Undo** without querying, and the server's "is this still the newest?" check becomes one field comparison instead of a sort over `created`, which could tie for movements saved in the same millisecond. The pointer is updated in the same transaction as every movement, so it can't go stale.

_Why undo always passes validation:_ if the original is still the newest movement, nothing has changed quantities since, so the reverse is always possible. The one exception is the install-source rule (§8): undoing an uninstall to, say, In transit would be an install from In transit, which is allowed anyway. So reversals skip the install-source rule, and they ignore whether an entry has since been retired.

### 7.5 Offline behaviour

PocketBase has no offline cache. Data already loaded in the open app stays in memory and is shown with the offline banner (§4). All writes (movements, parts, reference lists) are disabled while offline instead of queued. _Why:_ a queued "install 1 from Lab" could become invalid by the time it syncs, and the server would reject it anyway. Blocking up front is simpler and more honest. A full reload while offline has nothing to show, so it gets the error state with **Retry**. An offline-capable PWA with queued writes is a v2 idea (§11).

### 7.6 Safety net and back-dating

- **Recalculate totals** (a developer action in Settings, `POST /api/stocky/parts/{id}/recalculate`): replays a part's movements in `date`, then `created` order, and compares the result with the stored totals. It reports any difference and offers to fix it, writing the fix in a transaction. This makes option A available as a check, without using it on every read.
- **Back-dating trade-off:** validation uses current totals, not totals as of the back-dated `date`. Example: today there are 0 at Lab, and you back-date a "move 1 out of Lab" to last week. That's rejected, even if there was stock last week. Record the missing earlier `stock_in` first. Fully time-aware validation is out of scope for v1.
- Because of that trade-off, a correct history can dip below zero partway through the replay (a back-dated stock out sorted before the stock in that covered it). Recalculate reports such a dip (`dippedBelowZero`) but still allows the fix; it refuses only when the replay **ends** below zero.

### 7.7 Route reference

All routes are in `pb_hooks/routes.pb.js` and `pb_hooks/discovery.pb.js`, need a signed-in `users` record (superuser tokens are refused), and run in one transaction (the discovery preview writes nothing).

| Route                                     | Body                                                                                                                                           | Returns                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `POST /api/stocky/movements`              | `type`, `quantity`, `date`, the relations for the type, optional `reason`, `priceMinor` + `priceCurrency`, `note`; `part` **or** `newPart` (`stock_in`, `found_installed`) | `{ movement, part }` |
| `POST /api/stocky/movements/{id}/undo`    | `date`: today on the phone (the server doesn't know its time zone; it falls back to today in UTC)                                              | `{ movement, part }` (the reversal)        |
| `POST /api/stocky/seed`                   | none                                                                                                                                           | `{ seeded: true, preset }`, or `{ seeded: false }` if already done |
| `POST /api/stocky/parts/{id}/recalculate` | `fix: true` to write the replay; otherwise a dry run                                                                                           | `{ matches, fixed, stored, computed, dippedBelowZero, movements }` |
| `POST /api/stocky/discovery/preview`      | `host`, `snapshot` (the file's **text**, parsed on the server)                                                                                 | `{ rows, previewHash, warnings, skipped, ignored, snapshot, previous, host }`; writes nothing |
| `POST /api/stocky/discovery/apply`        | `host`, `snapshot`, `previewHash`, `decisions: { <rowId>: { apply, action, location?, reason?, partId?, newPart? } }`, `date`                   | `{ import, movements, summary }`           |
| `GET /api/stocky/about`                   | none (signed-in users only)                                                                                                                    | `{ pocketbase, schema, migration }` for the About dialog |
| `POST /api/stocky/imports/{id}/undo`      | `date`: today on the phone                                                                                                                     | `{ import, reversed }`                     |

**Errors** from the routes and the reference-list hooks are `400 { status, message, data: { code, … } }`. `message` is ready to show (the §4 texts), and `data.code` is for the client's logic. PocketBase's own `ApiError` rewrites plain `data` values and recases the message, so these replies are written by the hooks directly (`respond()` in `pb_hooks/lib/stocky.js`).

| `data.code`                                                                                          | When                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insufficient_stock` (+ `available`)                                                                 | not enough at the source. The client shows "Stock changed on another device, please review" when its own data showed enough, otherwise the server's "Only N … available" message |
| `install_source`, `same_location`, `invalid_shape`, `invalid_type`, `invalid_quantity`, `invalid_reason`, `invalid_price`, `invalid_date`, `future_date`, `invalid_note`, `invalid_part` | the §8 movement rules                                                                                                                                                |
| `retired`, `part_archived`, `not_found`                                                              | a target is retired or archived, or isn't yours (it reads as not found, so other users' IDs aren't confirmed)                                                       |
| `already_undone`, `is_reversal`, `not_newest`, `window_passed`                                       | the §4.8 undo errors                                                                                                                                                 |
| `duplicate_name` (+ `partId`)                                                                        | §4.6 "You already have '…' — open it?"                                                                                                                               |
| `in_use` (+ `parts`), `has_hosts` (+ `hosts`), `invalid_site`                                        | §4.10 retire guards, and the delete stock-scan                                                                                                                       |
| `replay_negative`                                                                                    | recalculate with `fix: true` when the replay ends below zero                                                                                                         |
| `import_movement`                                                                                    | the single Undo on a movement an import wrote                                                                                                                        |
| `invalid_units`, `units_inconsistent`                                                                | units sent by the client, or the consistency rule (§8) would break                                                                                                   |
| `invalid_json`, `invalid_snapshot`, `invalid_schema`, `virtual_host`, `too_many_items`, `too_large`  | the §13.3.2 snapshot checks                                                                                                                                          |
| `preview_stale`, `invalid_decision` (+ `row`), `invalid_category` (+ `row`), `model_mismatch` (+ `row`) | apply: the inventory changed since the preview, or a decision doesn't fit its row                                                                                    |

Superuser requests through the records API (the dashboard) skip the reference-list guards on purpose, so an admin can repair data by hand; the routes have no superuser path.

## 8. Validation rules

**Parts**

- Name: required, trimmed, 2–80 chars, unique per user by `nameKey`.
- Category: required, an active category (an existing part may keep a retired one).
- Unit: required, one of `pcs`, `sheets`, `m`.
- Manufacturer and model: each optional, up to 60 chars. Notes: optional, up to 500 chars.
- Threshold: blank, or a whole number from 0 to 9,999.
- Archived parts can't be picked for new movements (unarchive first).

**Sites, hosts, categories**

- Label: required, trimmed, 1–40 chars, unique (case-insensitive) among active entries of the same list.
- A host's site must be an active site.
- Retire guards from §4.10: a site needs no spare stock and no active hosts; a host needs nothing installed; In transit can never be retired.
- Delete only when never referenced.

**Movements** (checked in the form, again inside the transaction, and for types in rules)

- Quantity is a whole number from 1 to 9,999. There are no fractions, whatever the unit.
- Date is required and not in the future. "Today" is the phone's current time zone.
- Every location/host in the movement must be **active**. Reversals are exempt (§7.4).
- **stock_in:** `to` is a location. Price is optional: a whole number in the currency's minor unit, from 0 to 99,999,999, plus a currency (TWD, EUR or USD).
- **stock_out:** `from` is a location with `spare[from] ≥ qty`, or a host with `installed[from] ≥ qty` (§13.4.2), and a reason is required.
- **move:** `from` ≠ `to`, both are locations, and `spare[from] ≥ qty`.
- **install:** `to` is a host, and `from` is either **that host's site** or **In transit**, with `spare[from] ≥ qty`. You can't install Lab stock into a Office host. Reversals are exempt.
- **uninstall:** `from` is a host with `installed[host] ≥ qty`, and `to` is any active location (defaults to the host's site).
- **found_installed:** `to` is an active host; no `from`, no price, no reason. It may create its part (`newPart`).
- **units** (discovery only): each belongs to the movement's part, there are no more than the quantity, and each is where the movement starts (or, for a movement with no source, not installed anywhere). **Consistency rule:** at every host and location, a part's units never outnumber its quantity there.
- **undo:** only when eligible (§7.4); an import is undone as a whole (§13.4.4).
- Quantities never go negative. This is the invariant the transaction protects.

## 9. Hosting, environments and deployment

Running it, the reverse proxy, mail, backups and building the image: `docs/deploy.md`.

### 9.1 Development

- Runs locally: `npm run dev` (Vite) plus a local **PocketBase** on `127.0.0.1:8090` (the release binary, or the Stocky image with a local `pb_data`). A Vite `server.proxy` forwards `/api` and `/_` to it, so dev is same-origin like production.
- Collections, fields, indexes and API rules are code: JS migrations in `pb_migrations/` (committed). Server logic lives in `pb_hooks/`. `pb_data/` is local data and is gitignored.
- The API rules get their own tests against a throwaway PocketBase, covering at least: another user can't read your data, a movement can't be updated or deleted, an undo after 24 h is rejected, a referenced host can't be deleted, and nobody can sign up.
- No secrets or environment config are needed in the frontend: it talks to its own origin (`new PocketBase('/')`).

### 9.2 Accounts (no public sign-up)

- The app has no sign-up screen. The superuser creates your account in the **PocketBase dashboard** (`/_/`).
- The `users` collection's create rule is locked (`null`), so the API itself refuses sign-ups, even from crafted requests. The API rules (§6) also scope every record to its owner.
- Keep the dashboard (`/_/`) reachable only from your LAN or VPN, not from the internet (`docs/deploy.md`).

### 9.3 Production: one Docker container

- Image `0xwulf/stocky` (multi-arch: arm64 + amd64): PocketBase serves the API, the dashboard and the built app (`pb_public`, with an `index.html` fallback so vue-router deep links like `/parts/abc` survive a refresh).
- Runs behind a TLS reverse proxy that passes realtime (server-sent events) through unbuffered (`docs/deploy.md` has an nginx example).
- All state lives in the `pb_data` volume (SQLite and settings). Back it up; take a backup before releases that change the schema, since migrations apply on start.
- Password-reset mail uses PocketBase's SMTP setting (dashboard → Settings → Mail settings).

## 10. Out of scope for v1

- Full serial tracking (choosing serials in Record, per-unit history). Discovery's limited units (§13.4.3) are in scope.
- Barcode/QR scanning.
- Currency conversion, inventory value, purchase vendors.
- Per-site low-stock thresholds.
- Fractional quantities and user-defined units.
- Editing or deleting movements (only undo of the most recent, within 24 h).
- Deleting parts (archive only); hard-deleting referenced sites, hosts or categories.
- More than one In transit location, travel direction, or trip grouping.
- Public sign-up, social logins, MFA.
- Photos and attachments.
- Sharing or multiple users per inventory; roles.
- Offline writes and queued movements.
- Notifications (email/push) for low stock.
- CSV import/export.
- Cloud VPSes, networking, services and monitoring of any kind.
- Localization (UI is English only).

## 11. Version 2 ideas

- **Serial tracking:** a per-part "track serials" switch (for Pis, HDDs, NVMe), with per-unit history and "which exact drive is in nas-a?".
- **Scanning:** retail EAN/UPC barcodes with the phone camera to find or create a part, then printable Stocky QR labels for parts and storage boxes.
- **Per-site low-stock thresholds** (e.g. keep 2 in Lab _and_ 1 in Office).
- **Money:** currency conversion and inventory value per site in one base currency.
- **Fractional quantities** for units like metres, if whole numbers prove too coarse.
- A trip packing list: pick parts for the next Lab ⇄ Office trip, move them all to In transit in one step, then to the destination when you arrive.
- Low-stock alerts (email or push).
- CSV export/import and a JSON backup.
- An offline-first PWA (installable, queued writes with conflict review).
- Part photos via PocketBase file fields.
- **DSM collector:** a hardware-discovery collector for Synology DSM, whose hardware the Ubuntu collector can't read (§13.2.2, decision #23.6).

## 12. Decisions log (2026-10-03)

| #   | Question                | Decision                                                                                                                                                                    | Affects               |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Fixed or editable lists | Sites, hosts and categories are editable in the app. **Amended by #20 and #27:** seeded from a preset, by default one site (Home), In transit and generic categories; a homelab's own lists are an opt-in preset (`example` built in, more from `stocky-presets.json`). Retire hides an entry but keeps history; hard delete only if never referenced. | §4.10, §5.3, §5.4, §6 |
| 2   | Serial numbers          | Quantities only in v1; per-part serial switch in v2. Free-text movement note for now.                                                                                       | §10, §11              |
| 3   | Scanning                | v2: retail EAN/UPC first, then Stocky's own QR labels.                                                                                                                      | §11                   |
| 4   | Hosting                 | ~~Firebase Hosting for v1; self-hosting in v2.~~ **Superseded by #14.**                                                                                                      | §9.3, §11             |
| 5   | Prices                  | Optional unit price on stock in, stored in its original currency (TWD, EUR or USD since #21); no conversion.                                                                               | §4.7, §5.2            |
| 6   | Sign-up                 | No public sign-up; the account is created in the PocketBase dashboard; the `users` create rule is locked and rules scope everything per user.                                                                   | §4.2, §9.2            |
| 7   | Low-stock threshold     | One per part, against total spares including In transit; in transit is shown separately. Per-site in v2.                                                                    | §4.3, §5.2            |
| 8   | Install source          | Only from the host's own site or In transit.                                                                                                                                | §8                    |
| 9   | Fixing mistakes         | Append-only, plus undo of the most recent movement within 24 h as a reversing movement.                                                                                     | §4.8, §7.4, §6        |
| 10  | In transit              | One location; the movement note covers trip details.                                                                                                                        | §5.4                  |
| 11  | Units                   | Whole numbers only; each part has a unit label (pcs, sheets, m).                                                                                                            | §5.2, §8              |
| 12  | Dates                   | Date only, no time; "today" follows the phone's time zone. Stored as `YYYY-MM-DD`.                                                                                          | §5.2, §8              |
| 13  | Stack                   | Add vue-router and the `pocketbase` JS SDK (firebase and its emulators dropped by #14). State: plain composables, no Pinia (decided at step 3).        | §1, §9.1              |
| 14  | Backend and hosting     | Fully self-hosted: one Docker container running **PocketBase** (auth, SQLite, API rules, realtime) that also serves the app, behind a TLS reverse proxy. **No Firebase.** Movements go through a server-side route that runs in one DB transaction, so consistency is server-enforced. Reason: self-hosting and containers instead of a cloud backend. | §1, §4, §5–§7, §9, §10, §11, `docs/deploy.md` |
| 15  | Config                  | App, API and dashboard share one origin, so the frontend needs no environment config and the public image holds no data or settings. Runtime settings (SMTP, limits) live in `pb_data`. | §9, `docs/deploy.md` |
| 16  | PocketBase data shape   | Flat collections with a `user` relation; references are relations. `spare`/`installed` stay `json` fields on `parts` (all quantity writes go through one route; revisit at ~5,000 parts). Seeded entries are found by a per-user `key`, because PocketBase record IDs are 15 characters and unique per collection, not per user. (2026-10-04) | §5, `docs/deploy.md` |
| 17  | Server-enforced writes  | Movements, undo, seeding and recalculation are server routes in `pb_hooks`, each in one transaction; `movements` has create/update/delete `null`. `referenced`, `nameKey` and the retire guards are set or checked by server hooks, not the client. (2026-10-04) | §6, §7 |
| 18  | Empty numbers           | PocketBase number fields can't be empty (unset = 0). Low stock uses `lowStockEnabled` (bool) + `lowStockThreshold`; on movements, an empty `priceCurrency` means no price, so a price of 0 stays possible. (2026-10-04) | §5.2 |
| 19  | PocketBase version      | Pin **0.40.4** (binary checked against the release `checksums.txt`). Production runs `--automigrate=false --dev=false --hooksWatch=false`. Relevant 0.40 changelog items: 0.40.0 moved to Go's `encoding/json/v2` (json fields; test before upgrading), enabled SQLite defensive mode, and made console command errors exit non-zero; 0.40.3 fixed the index validator for `WHERE` clauses with parentheses (our partial indexes) and nested cascade delete of self-referencing relations (`movements.reverses`). Rules can follow relations in the request body (`@request.body.site.user`), verified on 0.40.4. Read the changelog before any upgrade. (2026-10-04) | §6, §9, `docs/deploy.md` |
| 20  | Universal seeding       | New accounts get the `standard` preset (Home, In transit, generic categories, no hosts). A homelab's own lists become an opt-in preset, chosen per account by the superuser through `users.seedPreset` before the first login. Presets are data in `pb_hooks/lib/presets.js`. Reason: make Stocky usable beyond one homelab. (2026-10-04) | §1, §3, §5.2, §5.4 |
| 21  | Currencies              | TWD, EUR and **USD** (USD added for universal use; cents like EUR). Sites may have an optional default currency, edited in the site form. Without one, a stock in uses the last currency used on the device, or the user picks one. (2026-10-04) | §4.7, §4.10, §5.2, §8 |
| 22  | History filters         | Type, part, date range and place are PocketBase filters on the server (place = OR over the four from/to relations), with a per-page lookup of reversals so "Undone" survives filtering. Replaces in-memory filtering. (2026-10-04) | §4.8, §5.2 |
| 23  | Hardware discovery      | §13 approved as a draft: a read-only collector (`tools/stocky-collect.sh` in this repo; copies elsewhere record its source commit) prints JSON on physical hosts only; JSON is uploaded into a preview and written only on confirmation; new type `found_installed` (also in Record), reversed by `stock_out` from a host; discovery-only units for serials (full tracking stays v2); `system` checked by default on SBCs only; Synology/routers stay manual (DSM collector in §11); hostile-string fixtures and invalid-JSON rejection. Built after screen groups 2–6 and before step 5. (2026-10-04) | §11, §13 |
| 24  | Publishing              | Published as a public repository with fresh history, from a redacted snapshot of the development repository (personal hosts, addresses and deployment notes left out). (2026-10-05) | — |
| 25  | Discovery D1 details    | Units follow movements (a hand-recorded movement takes excess units along, so units never outnumber quantities); the snapshot is sent as text and parsed on the server; `movements.import` back-links; undo-import conditions; default checkboxes; cross-site moves as uninstall → move → install. Details in §13.11. (2026-10-05) | §5.2, §7, §8, §13.11 |
| 26  | Discovery after first use | Declined items remembered per host (`hosts.discoveryIgnored`); Conflict rows for cpu/memory/board/drive model mismatches, never adopted; imports that only link serials shown in History; top-bar Import with host suggestion (machine, then hostname) and Add host. Details in §13.11.9–12. (2026-10-05) | §4, §4.8, §4.11, §5.2, §13.11 |
| 27  | Presets from a file     | `users.seedPreset` becomes text (migration 1791072010; 1791072006 unchanged), checked by a hook against the presets that exist: built-in `standard` and `example`, plus `<pb_data>/stocky-presets.json`, validated on every read and ignored as a whole when invalid. Own presets need no rebuild or migration, and the public image holds no personal lists. (2026-10-05) | §5.2, §5.4, `docs/presets.md` |

## 13. Hardware discovery

> Status: **approved on 2026-10-04 (decision #23). Phases D1 (data, routes), D2 (collector) and D3 (screens: §4.8, §4.10, §4.11) built on 2026-10-05**; §5–§8 include them. D4 (push with a token) stays optional (§13.9). It moves a limited form of serial tracking into scope; full serial tracking stays a v2 idea (§11). Decisions: §13.10; what D1 settled beyond the draft: §13.11.

### 13.1 Goal and boundaries

Populate Stocky from the physical hosts themselves instead of typing what's installed in each machine: a **read-only collector** runs on a host and prints a JSON snapshot; the snapshot is **uploaded in Stocky**, shown as a **preview**, and only what the user confirms is written.

- **Physical hosts only.** The collector detects virtual machines, containers and WSL and refuses to run there (§13.2.2).
- **Nothing is written without confirmation.** The preview computes a diff and writes nothing; applying it is a separate, explicit step (§13.3).
- **No SSH from the container**, no agents, no polling. The operator runs the collector by hand on each host. (Pushing a snapshot with a scoped token is an optional later phase, §13.3.4, and even then it only lands as a pending import.)
- **Tested without real machines.** The collector is developed and tested against fake `/sys` and `/proc` trees (§13.11, D2); the operator runs it on their hosts.

### 13.2 The collector (`stocky-collect`)

#### 13.2.1 Where it lives

**This repo is the source of truth** (decision #23.5): `tools/stocky-collect.sh` lives next to the JSON schema `docs/discovery-schema.json` and the test fixtures (`tools/fixtures/`), so the collector, its contract and the importer are versioned and tested together, and anyone using Stocky gets the collector with it.

**Copies elsewhere** (for example in a scripts repository deployed to your machines) record where they came from in the header, e.g. `# Source: https://github.com/hexawulf/stocky tools/stocky-collect.sh @ <commit>`, so it's clear which version runs where. A copy is updated only by copying a newer Stocky version, never edited in place.

#### 13.2.2 Behaviour

- `set -euo pipefail`, metadata header, POSIX-friendly Bash, coloured messages with a non-interactive fallback, a log in `~/logs/stocky-collect_YYYYMMDD_HHMMSS.log` (the conventions of the author's other scripts).
- **Read-only.** It writes only the JSON (stdout, or `-o FILE`) and its log. No installs: it uses tools present on a standard Ubuntu install (`lsblk`, `lscpu`, `ip`, `/sys`, `/proc`, `dmidecode` on x86) and uses optional tools only if they're already there (`smartctl` from smartmontools, `lsusb`). JSON is built in Bash (tools that already emit JSON, `lsblk -J`, `lscpu -J`, `ip -j`, are passed through; everything else goes through a small escape function), so no `jq` or Python is needed.
- **sudo, only for two tools:** `sudo -n dmidecode` (memory modules, board and memory serial numbers on x86) and `sudo -n smartctl -i -j` (drive serials hidden behind USB bridges). `-n` means it never prompts; if sudo isn't available non-interactively, or `--no-sudo` is given, those parts are skipped and listed under `warnings`. The script states at start which sudo commands it will run, listing only what applies on that platform (no dmidecode on ARM; nothing when there's nothing to run).
- **Usage:** `stocky-collect.sh [-o FILE] [--no-sudo] [--dry-run]`. `--dry-run` lists what it would read and run and collects nothing. Exit codes: 0 done, 1 error, 2 usage, 3 refused (VM, container, WSL). At most 200 items; more are dropped with a warning.
- **Refuses virtual machines:** if `systemd-detect-virt --vm` or `--container` reports anything, or `/proc/sys/kernel/osrelease` contains `microsoft` (WSL), or `/.dockerenv` / `/run/.containerenv` exists, or the DMI vendor or product names a hypervisor (KVM, QEMU, VMware, VirtualBox, Hyper-V's "Virtual Machine", Xen, cloud vendors), it prints e.g. "virtual machine (kvm): Stocky tracks physical hardware only" and exits with code 3 without output. So cloud VPSes and WSL are refused. Synology DSM (nas-a, nas-b) and the routers aren't Ubuntu and aren't supported in this phase.

#### 13.2.3 What it collects

| Item kind | Source (x86) | Source (Raspberry Pi) | Serial |
| --- | --- | --- | --- |
| `system` (the host itself) | `/sys/class/dmi/id/{sys_vendor,product_name}` | `/proc/device-tree/model`, revision code in `/proc/cpuinfo` (gives RAM size) | `dmidecode -s system-serial-number` (sudo); Pi: `/proc/device-tree/serial-number` |
| `board` | `/sys/class/dmi/id/{board_vendor,board_name}` | (same as system: SoC board) | `dmidecode -s baseboard-serial-number` (sudo) |
| `cpu` | `lscpu -J` (model, sockets, cores) | `lscpu -J` | none |
| `memory` | `dmidecode -t memory` (sudo): each module's size, type, speed, form factor, part number, slot | `/proc/meminfo` total only (soldered) | module serial (sudo) |
| `drive` | `lsblk -J -d -b -o NAME,MODEL,VENDOR,SERIAL,SIZE,TRAN,ROTA,TYPE,WWN`; `smartctl -i -j` to fill a missing serial | same (NVMe on the Pi 5 PCIe, USB drives, the SD card) | lsblk/udev, else smartctl (sudo) |
| `nic` | `ip -j link` + `/sys/class/net/*/device` (physical only: skips `lo`, bridges, veth, Docker, WireGuard, Tailscale, VLANs) with PCI/USB vendor and device IDs | same | MAC address |
| `usb` | `/sys/bus/usb/devices/*/{idVendor,idProduct,manufacturer,product,serial}`, skipping hubs and root hubs | same | USB serial if the device has one |
| `hat` | — | `/proc/device-tree/hat/{vendor,product,product_id,uuid}` (HATs with an ID EEPROM) | HAT `uuid` |

What's left out: loop, zram, RAM, md, device-mapper, nbd and optical devices; network interfaces without a backing device (lo, bridges, veth, Docker, WireGuard, Tailscale, VLANs); USB hubs and root hubs, and USB devices that lsblk or the NIC list already report (mass storage, network adapters). Firmware placeholders ("To Be Filled By O.E.M.", "Default string", "System Serial Number", `00000000`, …) count as empty. A NIC on a platform or SDIO bus (the Pi's Ethernet and Wi-Fi) or on PCI bus `00` (chipset) is `onboard: true`; a USB one is `onboard: false`; other PCI NICs leave it unset (so they're unchecked in the preview). `lspci -mm` and `lsusb` supply readable names when present. `slot` is the stable part of the device path: `ata1`, `nvme0`, `mmc0`, `usb2/2-1`, or dmidecode's locator (`DIMM A`).

Each item carries `kind`, `vendor`, `model`, `serial` (or left out), kind-specific fields (`sizeBytes`, `interface` such as `nvme`/`sata`/`usb`, `slot`, `memoryType`, `speedMTs`), and a capped `raw` object with the source fields for troubleshooting.

#### 13.2.4 Output (schema `stocky.discovery/1`)

```json
{
  "schema": "stocky.discovery/1",
  "collector": "stocky-collect 1.0.0",
  "collectedAt": "2026-10-20T09:14:03+08:00",
  "host": {
    "hostname": "pi-b",
    "machineIdHash": "sha256:…",
    "platform": "aarch64",
    "virtual": false,
    "model": "Raspberry Pi 5 Model B Rev 1.0"
  },
  "items": [
    { "kind": "drive", "vendor": "Samsung", "model": "SSD 980 PRO 1TB", "serial": "S5…", "sizeBytes": 1000204886016, "interface": "nvme" }
  ],
  "skipped": [{ "kind": "memory", "reason": "dmidecode needs sudo (--no-sudo given)" }],
  "warnings": []
}
```

`machineIdHash` is a SHA-256 of `/etc/machine-id`, so a re-import can recognise the same host after a rename without storing the raw ID. MAC addresses and serial numbers are sent as-is: they're needed for matching and stay in the user's own PocketBase.

### 13.3 Import path

#### 13.3.1 Flow

1. In Stocky, **Settings → Hosts → a host → Import discovery** (or a host's detail page later). The host is chosen first, so the snapshot always lands on one of the user's own active hosts; a mismatch between the snapshot's hostname or `machineIdHash` and that host's previous import is shown as a warning.
2. **Upload** the JSON file (picked from disk or pasted). The browser checks size (≤ 256 KB) and `schema` before sending.
3. **Preview:** `POST /api/stocky/discovery/preview` (auth, read-only) validates the snapshot, compares it with the host's current state (installed quantities, known units, previous import) and returns a **proposal**: one row per detected item with the suggested action (§13.6), the matched or suggested part, and a `previewHash`. Nothing is written.
4. The **preview screen** lists rows grouped as *Unchanged · New · Missing · Replaced · Moved · Ignored*, each with a checkbox (new and missing rows unchecked by default when the match is uncertain), editable clean name, category and unit for new parts, and the "not detectable" panel (§13.8).
5. **Apply:** `POST /api/stocky/discovery/apply` with the same snapshot, the user's decisions and the `previewHash`. In **one transaction** the server recomputes the proposal, refuses with `preview_stale` ("Your inventory changed since this preview; review it again") if the hash differs, then writes the confirmed movements, parts, units, learned name mappings (§13.5) and an `imports` record. Undo: §13.4.4.

#### 13.3.2 Validation on the server

The snapshot is untrusted input: **anything that isn't valid JSON is rejected** (`invalid_json`, before any other check, in the browser and again on the server); schema version checked; strings trimmed and capped (model 120, serial 80 characters), control characters removed, other Unicode kept as text and never interpreted (no HTML, no filter strings: values only reach PocketBase as parameters); at most 200 items; unknown fields dropped; `virtual: true` refused; the stored copy in `imports.snapshot` is the validated one.

#### 13.3.3 Why upload and not pull

Stocky runs in a container; giving it SSH keys to your machines would be a large new attack surface for a convenience. An upload keeps the container passive and the operator in control of when each host is read.

#### 13.3.4 Optional later: push with a scoped token

A per-user **discovery token** (collection `discovery_tokens`: user, label, `tokenHash`, created, lastUsed, expires, revoked) created in Settings and shown once. `stocky-collect --push https://stocky.example.com --token …` then sends the snapshot to `POST /api/stocky/discovery/upload`, which accepts only that token (no session), only that user's data, and only creates a **pending import** that waits for the same preview-and-confirm step in the app. Tokens are stored hashed, can't read anything, expire, and can be revoked. Not part of the first phase.

### 13.4 Data model changes (impact on §5–§8)

#### 13.4.1 New movement type `found_installed`

Records that N units of a part are installed in a host **with no source**: they were there before Stocky knew about them (initial population, or an item discovery finds that nobody recorded).

| Type | From | To | Effect |
| --- | --- | --- | --- |
| `found_installed` | — | active host | `installed[host] += N`; spares and `spareTotal` unchanged |

- Allowed from discovery apply **and** from the Record screen as a sixth type ("Found installed"), because initial population by hand needs it too.
- No price, no reason; optional `units` (§13.4.3); quantity 1–9,999 as for every movement; the part may be created in the same transaction (`newPart`), like a stock in.
- Low stock (§4.3) isn't affected: installed parts aren't spares.

#### 13.4.2 Its reversal: `stock_out` from a host

`found_installed` has no source, so its reversal needs a movement that removes installed units with no destination. Instead of a second new type, **`stock_out` gains a host as an allowed source**: "N units left host H and are gone" (a failed drive thrown away, a module sold). That's also what a re-import uses for a confirmed *missing* item (§13.6).

| Original | Reversal |
| --- | --- |
| found_installed N → H | stock_out N from H (reason empty, as for every reversal) |
| stock_out N from H | found_installed N → H |

The existing rows of §7.4 are unchanged; `stock_out N from L ↔ stock_in N → L` still applies to locations. Undo eligibility (newest movement, not a reversal, under 24 h) is unchanged.

#### 13.4.3 Units: limited serial tracking

New collection **`units`**: one row per individual item with a known serial number.

| Field | Type | Notes |
| --- | --- | --- |
| `user`, `part` | relations | owner; which part it's a unit of |
| `serial` | text | as reported, ≤ 80 chars |
| `serialKey` | text | upper-cased, spaces and dashes removed; **unique per (user, part, serialKey)** |
| `host` | relation → hosts, optional | where it's installed |
| `location` | relation → locations, optional | where it sits as a spare (rarely known) |
| `status` | select | `installed` \| `spare` \| `gone` |
| `firstSeen`, `lastSeen` | text `YYYY-MM-DD` | from snapshots |
| `lastImport` | relation → imports | the import that last confirmed it |

- **Quantities stay the source of truth** for stock (§7); units are an annotation that makes matching and re-import reliable. A unit never changes a quantity by itself.
- `movements` gains an optional multi-relation **`units`**: which units a movement concerned. Discovery sets it; Record doesn't in this phase.
- Consistency rule: for a part at a host, `count(units installed there) ≤ installed[host]`. The server enforces it when it writes units; the remainder are "unserialised" installed items (recorded by hand, or no serial readable).
- Full serial tracking (choosing serials in Record, per-unit history screens) stays a v2 idea (§11); this is the subset discovery needs.

#### 13.4.4 Imports

New collection **`imports`**: user, host, `collectedAt`, `collector`, `machineIdHash`, `snapshot` (validated JSON, capped), `summary` (counts per group), `movements` (multi-relation to what it wrote), `unitsBefore` (json: the prior state of every unit it changed), created.

- **Undo an import** (a separate action, not the single-movement Undo): allowed when the import's movements are the account's newest, none is a reversal, and it's under 24 h old. One transaction writes the reversal of every movement (§13.4.2), restores the units from `unitsBefore`, and removes learned mappings created by that import. Otherwise the same rules as §7.4.

#### 13.4.5 Parts

`parts` gains **`matchKeys`** (json array of normalised raw model strings), the learned mapping from what a collector reports to a clean part (§13.5).

#### 13.4.6 Impact summary

| Section | Change |
| --- | --- |
| §2 Glossary | adds *Unit* (an individual serialised item), *Import*, *Found installed* |
| §4.7 Record | sixth type "Found installed" (To: active host); Stock out's "From" accepts a host |
| §4.8 History | imports shown as one collapsible group with **Undo import**; units listed on a movement row |
| §4.10 Hosts | per host: "Import discovery", last import date and collector version |
| §5.2 Data | `units`, `imports`, `parts.matchKeys`, `movements.units`, `movements.type += found_installed` (migration) |
| §6 Rules | `units` and `imports`: list/view own, create/update/delete `null` (server only, like movements); new routes preview/apply/undo-import |
| §7.3–§7.4 | write algorithm and reversal table rows of §13.4.2; import undo of §13.4.4 |
| §8 Validation | `found_installed`: `to` is an active host, no price, no reason; `stock_out` from a host needs `installed[host] ≥ qty`; units must belong to the part, and their count can't exceed the quantity |
| §10 Out of scope | "Individual serial numbers or unit tracking" becomes "full serial tracking"; discovery's limited units are in scope |

### 13.5 Matching and naming

**Part matching**, strongest first:

1. **Serial → unit:** the item's `serialKey` matches a known unit of the user → that unit's part (and it tells where the unit was last seen).
2. **Learned mapping:** the normalised raw model (`vendor + model`, upper-cased, whitespace collapsed, duplicate vendor prefix removed) is in some part's `matchKeys`.
3. **Exact model:** equals a part's `manufacturer + model`, normalised the same way.
4. **Suggestions only:** token overlap with part names (e.g. "990 EVO" and "1TB") is offered as "Is this …?" and never applied without a click.
5. Otherwise: **new part**, with a suggested clean name, category and unit.

Confirming a row with a chosen part stores its raw model in that part's `matchKeys`, so the next run matches it automatically.

**Clean names, categories and units** (suggestions, editable in the preview):

| Kind | Suggested name | Category key (standard / example) | Unit |
| --- | --- | --- | --- |
| drive | `{vendor} {model} {size}` with size as "1 TB", interface appended when not in the model ("… NVMe") | `storage` / `storage` | pcs |
| memory | `{size} GB {type}-{speed} {form factor}` ("16 GB DDR4-3200 SO-DIMM"), part number in `model` | `components` / `other` | pcs |
| cpu | `lscpu` model name, cleaned of "(R)", "(TM)", "CPU @ …" | `components` / `other` | pcs |
| nic (add-in, USB) | `{vendor} {product}` from PCI/USB IDs | `networking` / `networking` | pcs |
| usb | `{manufacturer} {product}` | `peripherals` / `other` | pcs |
| hat | `{vendor} {product}` | `computers` / `sbc` | pcs |
| system (SBC) | "Raspberry Pi 5 8 GB" from model + revision code | `computers` / `sbc` | pcs |

Every key above exists in its preset's seed lists (checked against `pb_hooks/lib/presets.js` on 2026-10-04: `standard` has `storage`, `components`, `networking`, `peripherals`, `computers`, `other`; `example` has `storage`, `networking`, `sbc`, `other`; presets from `stocky-presets.json` can reuse these keys, `docs/presets.md`). Keys only exist on seeded categories, so a user who deleted or retired one, or added categories by hand, gets `other`; if `other` is gone too, the row asks the user to pick a category.

**What's proposed by default** (decision #23.4): drives, memory modules, add-in and USB NICs, HATs and USB storage are proposed (checked). The `system` item (the host itself) is **checked on SBC hosts** (Raspberry Pi: the board is a part you buy and stock) and **unchecked on x86**. Onboard NICs, CPUs soldered to SBCs, keyboards, mice and other USB peripherals are listed but unchecked. Users can check any row.

### 13.6 Re-runs: reporting changes without double counting

The preview compares the new snapshot with the host's **current state** (`installed` quantities, units at that host, the previous import), not with the previous snapshot alone, so what was recorded by hand in between counts.

| Group | Detected when | Proposed action |
| --- | --- | --- |
| Unchanged | serial seen again at this host; or, unserialised, detected count = installed count | none (`lastSeen` updated) |
| Adopt | item matches an installed part without a unit (recorded by hand) | attach the serial as a unit, **no movement** |
| New | serial never seen, or detected count > installed count | `found_installed` for the difference, or "installed from stock" (`install` from the host's site or In transit) when the user says it came from spares |
| Missing | a unit installed here isn't in the snapshot, or detected count < installed count | choose: `uninstall` to a location (kept as a spare), `stock_out` from the host (gone, reason required), or "ignore this time" |
| Replaced | in the same slot or position a unit is missing and a different serial of the same kind is new | the Missing choice for the old unit plus the New choice for the new one, shown as one row |
| Moved | the serial is now on another host of the user | `uninstall` from the old host to its site and `install` from that site into this host (Stocky has no host-to-host type), as one confirmed row |
| Ignored | kind or item the user turned off, or undetectable | none |

**Double counting can't happen** because new rows only ever propose the *difference* between detected and recorded quantities, serials already linked to a unit are matched first, and apply recomputes everything inside the transaction (`preview_stale` if anything moved meanwhile). Running the same snapshot twice proposes nothing the second time.

### 13.7 Security and privacy

- Preview and apply require the user's session; everything is scoped to `user` like every other collection; `units` and `imports` are written only by the routes.
- The snapshot is stored for audit (capped) in `imports`; serials and MACs never leave the user's PocketBase.
- The optional push token (§13.3.4) is hashed at rest, write-only into pending imports, expiring and revocable.

### 13.8 What can't be detected, and how the UI says so

The collector can only see what the operating system reports. It **can't** see cases, power supplies (except as nothing), cables and adapters, fans and heatsinks, thermal pads and paste, passive PoE injectors, HATs without an ID EEPROM (many NVMe and PoE HATs), drives behind hardware RAID or some USB bridges (model and serial may be the bridge's), SD-card readers' cards when empty, and anything in hosts it doesn't support (Synology DSM, routers, VMs).

- The preview always shows a **"Not detectable"** panel: "Discovery reads drives, memory, CPU, network adapters, USB devices and Pi HATs. Cases, power supplies, cables, fans and passive adapters can't be detected; add them with Record → Found installed." with a link that opens Record pre-set to Found installed for this host.
- Items with a missing or bridge serial are marked "no serial: matched by count only".
- `skipped` and `warnings` from the collector (e.g. "memory skipped: dmidecode needs sudo") are shown at the top of the preview.

### 13.9 Roadmap position and phases

Order (decisions #23, #24): **screen groups 2–6 → D1–D3 → public release prep → step 5** (CI and Docker Hub). D4 is optional and comes later.

**Public release** (decision #24): published as a public repository with fresh history, from a redacted snapshot of the development repository.

| Phase | Content | Verified by |
| --- | --- | --- |
| D1 ✓ | migrations (`units`, `imports`, `parts.matchKeys`, `movements.units`, `found_installed`, `stock_out` from host); routes preview/apply/undo-import; Record's sixth type | API suites extended (no double counting on re-run, stale preview, import undo, consistency rule) |
| D2 ✓ | `tools/stocky-collect.sh` + `docs/discovery-schema.json` + fixtures (x86 desktop, Pi 5 with NVMe, VM refusal, and **hostile strings**: quotes, backslashes, control characters, non-ASCII in models and serials) | `bash -n`, shellcheck-style review, runs on workstation (`--no-sudo` and with sudo); its JSON parses and validates against the schema even with hostile strings; the importer rejects invalid JSON and stores hostile strings verbatim but inert |
| D3 ✓ | import preview screen, Hosts integration, History grouping | component tests; real snapshots imported from two Raspberry Pis and a desktop |
| D4 (optional) | discovery tokens and push | API tests for token scope, expiry, revocation |

### 13.10 Decisions (2026-10-04, decision #23)

1. **Reversal of `found_installed`:** `stock_out` from a host (§13.4.2). No separate `removed_installed` type.
2. **Found installed in Record:** offered as a sixth type, for manual initial population too.
3. **Units scope:** discovery-only units; Record doesn't choose serials. Full serial tracking stays a v2 idea (§11).
4. **Default rows:** as in §13.5, with the `system` item checked on SBC hosts and unchecked on x86.
5. **Source of truth:** this repo (`tools/stocky-collect.sh`, schema, fixtures); copies kept elsewhere record the Stocky commit they came from (§13.2.1).
6. **Unsupported hosts:** Synology NAS units and routers stay manual; a DSM collector is a v2 idea (§11).
7. **Hostile input:** D2 fixtures include quotes, backslashes, control characters and non-ASCII; the importer rejects invalid JSON (§13.3.2, §13.9).
8. **Category keys:** the keys in §13.5 exist in the presets; anything missing falls back to `other` (§13.5).

### 13.11 Settled while building D1 (2026-10-05, decision #25)

1. **Units follow movements** (§5.2): a movement's units go to its destination, and a hand-recorded movement that would leave more units than items at its source takes the excess along (least recently seen first). This keeps the consistency rule true without Record ever asking for serials, and an Undo brings the same units back.
2. **The snapshot is sent as text** (`body.snapshot`) and parsed on the server, so "anything that isn't valid JSON is rejected first" holds on the server as well as in the browser.
3. **`imports.movements` keeps the order** (a multi-relation) for undo, and **`movements.import`** points back, so History can group an import's rows from one page of movements without loading snapshots.
4. **Undo import** is allowed when the import is under 24 h old, not undone, no later import is still in effect, and `users.lastMovementId` is still the value it left (`lastMovementAfter`), which also covers imports that wrote no movement (adopt-only). Units it created become `gone` if a movement mentions them, otherwise they're deleted; its learned `matchKeys` are removed. Parts it created stay (they may be referenced; archive them by hand).
5. **Default checkboxes:** a missing unit matched by serial is certain, so its row is checked with "uninstall to the host's site" (reversible, keeps it as a spare); a count-only missing row is unchecked with "ignore this time". New rows with only "Is this …?" suggestions, a taken name or no category are unchecked.
6. **Moved across sites:** Stocky has no host-to-host type, so a unit found on a host at another site is uninstalled to its old site, moved to this host's site, and installed (three movements, one confirmed row).
7. A serial reported twice in one snapshot keeps its first item; the second is matched by count, with a warning.
8. **Recorded by hand under another name:** parts installed in this host that nothing detected accounts for are offered first under "Is this …?", with "(N recorded here)". Linking a New row to one of them adds the serial to that record (like Serial added, no movement) while the host has that many unexplained items, so a first import over hand-recorded hardware never counts it twice. Only parts that could be this item are offered that way (same kind, and no model words that contradict it), and the link is refused with `model_mismatch` across a model mismatch.

**After the first real imports (2026-10-05, decision #26):**

9. **Declined items are remembered per host.** On apply, every New or Conflict row left unchecked, set to "ignore this time", or kept out of a conflict adds its items' keys to the host's `discoveryIgnored` (`S:<serialKey>`, or `M:<kind>|<model key>` without a serial; at most 500). Next time such rows are marked `declined` and shown under Ignored, unchecked; checking one imports it and removes its keys. Undo import restores the list.
10. **Conflicts.** For `cpu`, `memory`, `board` and `drive`: when a part recorded in the host by count only (no unit explains it) is of the same kind as a detected New item and names a model the item doesn't share (model words: tokens with a digit, at least 3 characters, not a bare size such as `2TB`), the item becomes a **Conflict** row instead of New, and the recorded part's count-only Missing row shrinks by one. A part's kind comes from its units, else from words in its name and model (DDR/DIMM/RAM → memory; Ryzen/Core i5/Xeon/… → cpu; motherboard → board; SSD/NVMe/HDD/SATA or a size in TB → drive). Choices: keep (default, checked; remembered as declined), replace with uninstall to a location, or replace with stock out; replacing writes that movement for the recorded part and a `found_installed` for the detected one. A conflict never adopts: linking its item to the recorded part is refused (`model_mismatch`). A recorded part that names no model ("My boot SSD") is not a conflict; it stays an "Is this …?" suggestion (item 8).
11. **Imports that only link serials** are listed in History (`movements:length = 0` and `summary.serialsLinked > 0`), §4.8.
12. **Top-bar Import** with host suggestion, §4.11.

**D2 (2026-10-05):** the collector is tested without touching a real machine: `tools/test-collect.sh` builds fake `/sys`, `/proc` and `/etc` trees (a Pi 5 with NVMe, an x86 desktop, a Pi full of hostile strings, VM/WSL/container/Hyper-V/cloud cases), stubs `lsblk`, `lscpu`, `uname`, `dmidecode`, `smartctl`, `sudo` and `systemd-detect-virt` on `PATH`, and points the collector at the tree with `STOCKY_COLLECT_ROOT` (test-only; real runs read `/`). It checks the JSON against `docs/discovery-schema.json` with a dependency-free validator (`scripts/validate-schema.mjs`) and that hostile strings round-trip exactly. Three of its outputs are the committed fixtures `tools/fixtures/{pi5-nvme,x86-desktop,hostile-strings}.json` (`--write-fixtures` regenerates them); `vm-refused.json` and `invalid-json.json` are hand-written negatives for the importer. `npm run test:api` runs the harness, and `test-discovery.mjs` previews every fixture.
