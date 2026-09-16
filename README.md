# Cubby

Phase 9 of the Shared Voxel Home MVP: production-ready PWA, mobile hardening, realtime shared furniture and room synchronization, placement/move/rotate/remove, shared furniture persistence/library and voxel editor on the existing secure
shared-home/auth, React/Vite/TypeScript, React Three Fiber, and PWA foundation.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using the
   browser-safe values from your Supabase project.
3. Install dependencies with `pnpm install`.
4. Start development with `pnpm dev`.

The production build command is `pnpm build`, and Cloudflare Pages should
publish the generated `dist` directory. This app uses normal browser routes;
Cloudflare Pages' SPA fallback applies because the project does not ship a
top-level `404.html`.

## Two-person Supabase Auth setup

1. Open your Supabase project, then **Authentication → Users**.
2. Use **Add user → Create new user** (not Invite user).
3. Create two email/password users matching `src/features/auth/identities.ts`:
   `ben@cubby.example` and `partner@cubby.example`, or replace those identifiers
   in that file with your chosen internal emails. These need not be personal emails.
4. Choose a separate password for each account. Enable **Auto Confirm User**
   when creating each account; verify both are confirmed. No email delivery is
   needed. Keep passwords outside the source code and environment files.
5. In **Authentication → Sign In / Providers**, turn **Allow new users to sign up**
   OFF and save. Keep the Email/password provider enabled. Do not enable OAuth,
   anonymous sign-in, or phone sign-in for this app.
6. Edit the two display names/emojis/internal emails in `identities.ts` as needed.
   Internal emails are browser-visible configuration, not secrets; normal UI
   shows only display names. Never add passwords or service-role credentials.

Dashboard labels may vary slightly. See the official [general auth configuration](https://supabase.com/docs/guides/auth/general-configuration).

The Phase 3 database migration, seed template, grants/RLS explanation, and exact
Supabase setup order are documented in [supabase/README.md](supabase/README.md).
Use the Supabase CLI: authenticate/link once, then preview with `supabase db push
--dry-run --linked --include-seed` before any approved push. Setup resolves the
existing users by internal login email; no UUID placeholders or SQL dashboard
pasting are needed. Frontend route guards are not a replacement for database RLS.

## Authentication verification

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. No lint command is currently configured.
Tests use a mocked auth boundary for app behavior and the actual Supabase SDK
with isolated storage/mock HTTP responses for session persistence. They never
contact real accounts. Live-account verification still requires the steps below.
With your real Supabase users, verify:

- Open `/room` while logged out: it redirects to `/login`.
- The first login step shows exactly two identities and no password field.
- Select each identity, enter its password, and confirm arrival at `/room`.
- A wrong password shows feedback and never opens the room.
- Refresh and reopen the app on the same origin: the session restores.
- Visit `/login` while signed in: it redirects to `/room`.
- Settings shows the selected identity, without its internal email.
- Log out in Settings: return to `/login`; refresh and all protected URLs stay guarded.
- There is no signup, password-reset, or OAuth screen or auth action.

Supabase owns browser session storage and token refresh; the app subscribes to
auth changes and cleans up subscriptions on unmount. Logout applies to the
current device only. Network/setup errors keep concise feedback visible.

## Phase 4 local editor

Sign in, open Furniture, then **Create Furniture** (`/furniture/new`).
The editor retains the Phase 4 local controls. Only Save communicates with Supabase;
`/furniture/:id/edit` loads the shared saved name/model first. Leaving/reloading
discards unsaved edits and debug snapshots, not saved database records.

- Add: click/tap the floor to create a cube at y=0, or a cube face to add in
  the adjacent integer cell. Coordinates are 0–15 on each axis.
- Delete/Paint: click/tap the existing cube. Palette and custom hex color are supported.
- Camera: explicitly switch to Camera, drag/swipe to orbit, scroll/pinch to zoom.
  Switch back to a tool to edit. Edits require a single tap/click; drags and
  multi-touch in editing mode are ignored. Camera inertia/panning are disabled.
- Undo/Redo: snapshot history for add/delete/paint/clear/restore, up to 100
  previous models. No-op edits do not consume history; new edits discard redo.
  Furniture name is separate from voxel history; Clear leaves the name intact.
- Local/debug serialization: Capture snapshot, edit/clear, then Restore snapshot.
  This round trips the name and version-1 voxel JSON in memory, not files or shared saving.

Voxel JSON: `{ "version": 1, "size": [16,16,16], "voxels": [{ "x": 0,
"y": 0, "z": 0, "color": "#8b5e3c" }] }`. Maps keyed by `x,y,z` prevent
duplicates. Deserialization validates bounds, uniqueness, version, size and colors.
Rendering uses one instanced cube mesh, capped DPR 1.5, fixed lighting and
on-demand frames, rather than thousands of React mesh components.

Run `pnpm test`, `pnpm typecheck`, `pnpm build` (no lint script configured).
The tests exercise model/raycast/pointer logic, UI wiring, auth routes and RLS.
With `pnpm dev`, `/tests/editor.html` is a backend-free development-only browser
harness with a 900-voxel chair fixture. It is not an app route or production entry
and is absent from `dist`.

Manual verification on desktop and a physical touch device:

1. Name a draft and build a chair: floor cells, legs, seat, then back via face adds.
2. Recolor several cubes, delete some, and undo/redo each operation.
3. Clear, undo and redo; confirm capture → clear → restore reproduces name/colors/positions.
4. Try adding beyond the boundary and into occupied cells; counts must not increase.
5. Check drag/swipe in edit mode never edits. Camera mode must orbit/zoom without edits.
6. On touch: tap to add/delete/paint; use Camera for one-finger orbit/two-finger pinch.
7. Check the 900-voxel chair fixture or a detailed draft stays responsive on your phone.
8. Recheck `/room`, Settings/logout and session restoration.

Desktop browser interactions and 900-voxel rendering were checked during implementation.
Touch pointer handling is tested automatically; physical-device gestures/performance
still require the manual checks above. No database/config/env changes are required.

## Phase 5 shared furniture

The library fetches authoritative records on route entry, explicit **Refresh library**,
and Phase 8 realtime changes.
Creator display names come from the RLS-protected profiles relationship, not emails.
`src/features/furniture/data.ts` centralizes list/get/create/update/count/delete queries.
Each operation resolves the authenticated user's home using the existing helper.
Creation uses `auth.getUser().id` as creator; updates only change name/voxel_data.
IDs, home, ownership and timestamps remain database-owned; the Phase 3 trigger
updates `updated_at`. No migrations, privileged keys or new environment values are needed.

Save trims/requires a name and requires at least one valid voxel. Saving disables
editing/double submission and returns to the shared library. Failures retain the
draft. If a connection drops during creation, check the library before retrying:
an acknowledged failure may be ambiguous about whether the insert reached the server.

Delete first counts placed instances and presents a named confirmation with the
exact cascade warning. Cancel does nothing. Counts are checked again on confirmation;
if changed, a new warning requires confirmation again. Count failures block deletion.
The database cascades placed copies; the frontend never manually deletes placements.
Count/check/delete are separate API requests, not an atomic concurrency lock.

Manual two-user acceptance (two browser profiles/devices):

1. User 1: Create Furniture, name/build a design, Save furniture. Confirm creator/name in library.
2. User 2: open/refresh the library; confirm the same design and user 1's creator name.
3. User 2: Edit it, rename/recolor/add/delete, Save changes. Confirm the URL/record ID
   stays the same when reopening and the original creator remains unchanged.
4. User 1: refresh/reopen Edit; confirm the updated name/model. No live updates are expected yet.
5. Try whitespace-only name and empty model; each save must fail visibly without a write.
6. Disconnect during Save; confirm the draft/error remains. Reconnect/check library before retrying.
7. Reload, close/reopen the app and sign in again; saved records must still load.
8. Delete: check named warning, Cancel (record remains), then confirm (record disappears after refresh).
9. If existing placed rows are present, verify the exact copy count warning and cascade removal.
   Do not build placement UI or create placed instances through the app in this phase.
10. Log out; guarded routes remain inaccessible. Recheck the shared room/editor touch controls.

Automated tests cover simulated two-user CRUD, UI save/load/refetch, validation,
delete/cancel/count changes/failures, duplicate submits, component restarts, and
the actual migration's grants/RLS/triggers/cascades in isolated PostgreSQL.
Live-account writes/restarts still require the manual steps above; tests never
use real account passwords, hosted test furniture or privileged browser credentials.

## Shared room rendering (Phase 6 foundation)

`/room` now renders the fixed room (floor, grid, translucent back walls), not the
Phase 1 cube scene. Dimensions live in `src/features/room/config.ts`:
`ROOM_WIDTH = 16`, `ROOM_DEPTH = 16`, wall height 2, `VOXEL_UNIT = 0.25`.
One placement grid cell is one world unit; one colored voxel is one quarter-unit.

`fetchSharedRoom()` resolves the existing authenticated home, reads that home's
placed records, then calls `getFurnitureDefinitions()` in the furniture data layer
with the unique referenced IDs. Definitions are home-filtered and RLS-protected.
Models are validated/reconstructed once per definition. Missing/corrupt designs
show warnings without crashing the room; connection errors are not called an empty room.
Route entry, **Refresh room**, and Phase 8 realtime changes load authoritative data.

Stored x/z are floor-grid coordinates measured from the negative-X/negative-Z
room corner (world `[-8,0,-8]` with current dimensions). They anchor the minimum
corner of the **rotated occupied bounds**, not the editor volume or model center.
Positive Y rotation follows Three.js: 90° maps `(x,z)` to `(z,-x)`.
The lowest occupied Y is translated to zero, so designs built above the editor
floor also rest on the room floor. Empty X/Z margins are removed by the transform,
not by changing saved voxel JSON. `room/model.ts` contains this testable transform.
`PlacedVoxelModel` wraps the **same VoxelMesh used by the editor**, with transforms
and exact instance capacity; editor targeting/render coordinates are unchanged.
Room rendering uses fixed lighting, capped DPR 1.5, instancing and on-demand frames.
Camera framing adapts to viewport aspect; drag/swipe orbits and scroll/pinch zooms.

### Optional hosted rendering test data (CLI, no migration required)

1. In the app, create/save an asymmetric chair or L-shaped design (ideally with
   some empty space below it to check automatic floor alignment).
2. Open Edit and copy the furniture UUID from `/furniture/<UUID>/edit`.
3. Edit `supabase/test_room_rendering.sql`: set `design_id` to that UUID and verify
   `login_email` matches one configured internal identity. Auth/home UUIDs resolve
   automatically; no password or service-role key is needed.
4. From the linked project root, preview with:

   ```powershell
   supabase db query --linked --file supabase/test_room_rendering.sql
   ```

   The original template uses **ROLLBACK** to preview without persisting data.
   Review your current copy first: it may already have a configured UUID,
   COMMIT, or enabled cleanup DELETE from earlier manual testing. Do not rerun
   a configured apply/cleanup script as a preview. Do not use db reset or disable RLS. This file is not included
   in migrations or the default db-push seed list.
5. Review IDs/home/design/positions/rotations. When you choose to apply this test
   data, change the final `rollback;` to `commit;` and rerun that same command.
   The inserts use four reserved IDs and do not overwrite existing placements.
6. Refresh `/room` as both identities: instances should appear at `(3,3)/0°`,
   `(9,3)/90°`, `(3,9)/180°`, `(9,9)/270°`. Max design width/depth is four cells,
   so these test positions fit without overlapping. Cell `(0,0)` is the back
   corner where the two walls meet in the initial view. Compare backrests/colors.
7. Check feet touch the floor at all rotations; orbit/zoom on desktop and a real
   phone. Rotate the phone and check framing/no horizontal layout overflow.
8. Edit/save the design in Furniture, then refresh the room: every copy should
   use the updated design. No per-placement geometry is saved.
9. Cleanup: the script includes a DELETE targeting only those four
   reserved placement IDs. Put that statement alone in a reviewed temporary SQL
   file and execute via `supabase db query --linked --file <path>`. Keep the saved
   furniture design. Restore `rollback;` in the preview script when finished.

Alternatively, `pnpm dev` → `/tests/room.html` exercises the actual renderer with
an empty-room/four-chair fixture and no auth/backend. It is excluded from `dist`.
Automated tests cover home/reference filtering, all rotations/floor alignment,
missing/invalid data/errors/refetch, SQL preview/idempotence and earlier phases.
Desktop empty/rotated rendering, mouse controls and 390px viewport were checked.
Phase 6 hosted rendering was manually accepted before Phase 7.

## Phase 7 placement and room editing

### Apply the database guard through the existing linked CLI

No new environment values, tables, Auth users or home setup are needed. The new
`supabase/migrations/202609150002_placement_validation.sql` adds a private,
security-invoker placement trigger and footprint helper. RLS and existing API
privileges remain intact. It checks INSERT/position/rotation UPDATE and uses a
per-home transaction advisory lock to serialize competing placement writes.
The guard sees authoritative voxel definitions; timestamps still use the existing trigger.
It does not move/delete existing records on installation.

From the app repository root:

```powershell
supabase db push --dry-run
supabase db push
```

Review the dry run before applying. Phase 7's hosted migration and behavior were
manually accepted before Phase 8. Do not rerun Phase 3 setup, optional Phase 6 seed,
or `db reset`.
No service-role credential is used. If room constants are intentionally changed
later, a new migration must update the matching SQL constants (16 x 16, unit 0.25).

### Interaction and data flow

- **Place in Room** in the library opens `/room?place=<furniture UUID>`, loads
  that saved design with RLS, and starts a local preview; no write occurs yet.
- **Position furniture**: click/tap the floor (even through a rendered model)
  to select an integer x/z cell. The occupied footprint's minimum corner anchors
  there, and the lowest voxel rests on Y=0. Rotate preview in 90-degree steps.
  The footprint outline is green when valid, red when invalid. Confirm saves;
  Cancel discards the preview without touching existing placements.
- **Camera**: orbit/zoom only. **Select furniture**: tap/click a rendered model
  without camera motion. The placed-item dropdown also supports precise selection
  on phones. The selected footprint has a purple outline.
- **Move** enters the same preview mode with the original instance temporarily
  hidden. Confirm updates that instance ID; Cancel restores the original view.
  **Rotate 90°** validates then updates the current instance in place.
  **Remove** requires confirmation and deletes only that instance, not its design.
- `createPlacement`, `updatePlacement`, `removePlacement` are focused room data
  helpers. Home/creator come from the existing authenticated lookup/user. Create
  and update re-fetch the room and current design before validating. The database
  guard repeats validation atomically. Successful writes refetch authoritative room
  data; failed writes retain the draft, show an error and refresh. Double submits
  are locked. Phase 8 now synchronizes the other user's active room automatically.
- Room input reuses the editor's tested mouse/touch pointer handler: release-only
  taps edit; drags, canceled gestures and multi-touch do not. Camera mode has no
  editing listeners. Voxel editor input and default rendering remain unchanged.

### Bounds, collision and deliberate MVP limits

`src/features/room/placement.ts` contains pure snapping/rotation/bounds/collision
helpers. The rectangle is `(max occupied x - min occupied x + 1)` by the same
quantity for z, scaled by 0.25. It swaps width/depth at 90/270 degrees. Integer
x/z plus these extents must fit the 16 x 16 floor. Rectangle interiors must not
intersect another placed rectangle; touching edges are allowed. Moving/rotating
ignores its own instance, not other copies of the same design.

This intentionally conservative AABB approach can reject arrangements using
holes in L-shaped models or space underneath furniture; the reference explicitly
permits simple axis-aligned footprints. No stacking, vertical positioning,
free-angle rotation, physics or room editing is implemented. Designs
remain shared references: editing a design updates all copies after refetch.
Design resizing is not a room-layout operation and does not automatically repair
older placements; inspect and move/remove affected copies if their footprint grows.
Unavailable/corrupt placed definitions block new placement/movement until repaired
or removed rather than silently omitting them from collision checks.

### Manual Phase 7 acceptance

1. Apply the reviewed migration. Start `pnpm dev`; sign in as either existing user.
2. Choose **Place in Room**, tap a floor cell, rotate, confirm, and reload/restart.
   Verify the same instance remains; refresh as the other user to see it.
3. Select the item in Select mode and via dropdown. Move then cancel (no write),
   move then confirm (same instance ID), rotate through all four orientations.
4. Try negative/edge positions, a wide asymmetric model near each room edge,
   and overlapping copies before/after rotation. Invalid confirm must be disabled;
   invalid rotation must show feedback without changing the saved item.
5. Remove then cancel; remove then confirm. The saved design must remain in the library.
6. On a physical phone, check narrow layout, tap selection/positioning, camera swipe
   and pinch, switching modes, and ignored drags/multi-touch in Position mode.
7. Recheck editor Add/Delete/Paint/history/save and furniture Edit/Delete cascade warning.
8. In two sessions, attempt the same overlapping placement simultaneously; with
   the migration installed, at most one conflicting placement should succeed.

Checks: `pnpm typecheck`, `pnpm test`, `pnpm build` (no lint command is configured).
Tests exercise the real migration in isolated PostgreSQL and earlier-phase regressions.
Dev-only `/tests/placement.html` uses the production controls/renderer with in-memory
actions, not Supabase writes, and is excluded from `dist`. Hosted/two-device and
physical-phone acceptance remain manual. Phase 7 was manually accepted before Phase 8.

## Phase 8 realtime synchronization

`src/lib/supabase/realtime.ts` owns the shared subscription boundary. The furniture
library subscribes to `furniture`; the room subscribes to both `furniture` and
`placed_furniture`. INSERT and UPDATE streams are filtered by the active `home_id`.
Postgres Changes cannot reliably filter DELETE events, so delete notifications are
used only as a signal to refetch the current home's RLS-protected snapshot. Event
bursts are coalesced, every snapshot is reconciled by record UUID, and local writes
followed by their realtime echo therefore replace data instead of appending duplicates.

Initial subscription, reconnect, explicit refresh and successful local mutations all
converge on authoritative Supabase reads. A reconnecting/background-sync warning does
not erase the last usable snapshot. Channels and pending coordinators are disposed on
route unmount, identity change, active-home change or refresh-driven resubscription.
This is table-change synchronization only: there is no presence, chat, cursor sharing
or live collaborative voxel editing.

### Enable the two tables through the linked CLI

The versioned migration `supabase/migrations/202609150003_realtime_publication.sql`
idempotently adds only `public.furniture` and `public.placed_furniture` to the
`supabase_realtime` publication. It does not change RLS, grants, tables or stored data.

```powershell
supabase db push --dry-run
supabase db push
```

Review every dry run before applying. Phase 8's publication and two-session behavior
were manually accepted before Phase 9. Future schema changes must use a new migration;
do not edit or rerun applied migration files.

In Supabase, leave the Realtime service enabled and verify both tables appear
under **Database → Replication** for `supabase_realtime`. Existing SELECT RLS policies
still decide which rows each signed-in client can receive. No service-role key,
replica-identity change, Broadcast policy, Worker or Pages Function is required.

### Manual two-user acceptance

Use a normal browser profile and an incognito/separate profile or device so each can
hold a different authenticated session. Keep both relevant pages open and do not use
manual refresh while checking each realtime event.

1. Open `/furniture` as both users. User 1 creates a distinct non-empty design; it
   appears exactly once for user 2. User 1 edits its name/colors; user 2's existing
   row updates in place. Delete an unplaced test design and verify it disappears.
2. Keep `/room` open as both users. Place a saved design in a valid empty location;
   it appears exactly once for the other user. Move it, rotate it 90 degrees, and
   remove it; each change should appear without reload and preserve valid layout.
3. Edit a placed design in the furniture editor while the other user's room is open;
   after save, all of that design's placed copies should reconstruct from the new
   voxel definition. Delete it after accepting the cascade warning; its library row
   and placed copies should disappear in the other session.
4. Repeat a quick local create/update or place/move sequence and confirm the writer
   also has only one copy after its own realtime echo.
5. Disconnect one session in browser network tools, make changes from the other,
   then reconnect. The reconnecting session should refetch and match Supabase. If a
   transient sync error is shown, **Refresh library/room** performs the same recovery.
6. Navigate away, log out, log in as the other identity and return. Confirm there are
   no doubled events or stale updates from the disposed subscription. Recheck editor,
   collision/bounds validation, camera controls and Settings/logout on desktop and touch.

Checks: `pnpm typecheck`, `pnpm test`, `pnpm build` (no lint command is configured).
Automated tests cover every table/event type, ID deduplication, reconnect refetch,
identity-switch cleanup, migration idempotence and all earlier-phase regressions.
Phase 8 hosted two-session/reconnect behavior was manually accepted before Phase 9.

## Phase 9 production deployment and acceptance

The production PWA includes explicit 192×192 and 512×512 PNG manifest icons, a
maskable icon entry, a 180×180 Apple touch icon, a stable manifest ID, standalone
launch metadata and the generated Workbox service worker. The original SVG remains
the scalable browser favicon. The Phase 4 serialization panel is development-only
and is removed from production bundles. Mobile CSS uses 44px primary targets,
safe-area insets, a narrow header/navigation layout, wrapping controls and a
small-viewport scene height. Shared writes still require a network connection;
there is intentionally no offline editing or conflict resolution.

Run the full local release gate from the repository root:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm verify:production
pnpm preview --host 127.0.0.1 --port 4173
```

`verify:production` checks the built manifest, icon output, service worker, Cloudflare
SPA-fallback condition, production debug removal and browser credential boundary.
There is no lint script in this deliberately small project. `.node-version` pins the
Cloudflare build to Node 22.16.0; `package.json` pins pnpm 11.19.0.

### Cloudflare Pages Git deployment

Connect the GitHub repository to **Workers & Pages → Create → Pages → Connect to Git**.
Use these settings:

- Production branch: `main`
- Root directory: repository root (leave blank)
- Build command: `pnpm build`
- Build output directory: `dist`
- Build system: v3
- Functions directory: none

Set these production and preview build variables in **Settings → Environment variables**:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_BROWSER_SAFE_PUBLISHABLE_OR_ANON_KEY
PNPM_VERSION=11.19.0
```

Only the first two values are bundled into the browser. They are the project's normal
public API URL/key, not passwords. Never add a Supabase service-role/secret key.
`PNPM_VERSION` is a non-secret build-tool pin; Node is pinned in the repository.

Do not add `_redirects`, a top-level `404.html`, a Worker or a Pages Function.
Cloudflare Pages treats the output as an SPA when no top-level `404.html` exists and
serves `index.html` for direct React Router paths. After deployment, directly open
and refresh `/`, `/login`, `/room`, `/furniture`, `/furniture/new`, a real
`/furniture/<UUID>/edit`, and `/settings`.

In Supabase **Authentication → URL Configuration**, set **Site URL** to the canonical
Cloudflare/custom production origin, including `https://`. Add that same exact origin
to allowed redirect URLs if the dashboard requires it. Password login itself does not
use a redirect in this app. Keep email/password enabled, public signup disabled, and
the two existing users confirmed. No CORS exception, new database grant, service-role
key, or server-side auth code is required. Keep Realtime enabled and verify
`furniture` and `placed_furniture` remain in `supabase_realtime`.

### Production and installed-PWA acceptance

1. Push the reviewed commit to GitHub and wait for the Pages deployment to succeed.
2. Check every direct route and refresh listed above; protected routes should restore
   the session or redirect to `/login`, never return a Cloudflare 404.
3. In two separate production sessions, run the complete reference flow: both log in;
   user 1 creates a recognizable model; user 2 sees it live and places it; user 1 sees
   and moves it; user 2 sees and rotates it; both see removal/deletion. Confirm overlap
   and out-of-bounds attempts are rejected.
4. Reload and close/reopen both sessions. Confirm identity sessions, furniture and
   room state restore. Log out one session and confirm protected data disappears there.
5. In Chromium DevTools **Application → Manifest**, confirm all icon entries load and
   the service worker is active. Install from the production HTTPS URL and launch from
   the operating-system app launcher; confirm standalone display and session restore.
6. On iOS Safari, use **Share → Add to Home Screen**. On Android/desktop Chromium, use
   **Install app**. On a physical phone, recheck navigation, room select/position/camera
   swipe and pinch, editor Add/Delete/Paint taps, Camera swipe/pinch, confirmations,
   keyboard input, device rotation and absence of horizontal clipping.

Stop after Phase 9. Do not add post-MVP features.
