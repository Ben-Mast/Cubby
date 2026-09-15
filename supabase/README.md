# Phase 3 — Supabase CLI workflow

The two Auth users remain manually created/confirmed as in Phase 2. Database
schema and shared-home setup are repo-managed SQL; no dashboard SQL pasting or
Auth UUID copying is required. No service-role key is used.

## One-time authentication and link — do this first, then stop

The Supabase CLI is already installed on this machine (2.116.0). From the actual
Git repository root in PowerShell:

```powershell
cd "C:\Users\benja\Desktop\GitHub Repositories\Cubby\Cubby"
supabase login
supabase projects list
supabase link --project-ref YOUR_EXISTING_PROJECT_REF
```

Choose the existing hosted project used by the frontend. Its project ref is the
identifier in the dashboard project URL or the prefix of its Supabase URL.
Authenticate through the CLI's browser/login flow. If link requests your
Postgres database password, enter it at the prompt; this is NOT an Auth user's
password or an API key. Never paste credentials into chat, source, or commands.

Do not run `supabase init`: `config.toml` is already committed. Local linking
metadata in `supabase/.temp` and branch state in `supabase/.branches` are ignored.
Do not commit CLI access tokens or database passwords.

**After link succeeds, confirm the project is linked before any hosted SQL runs.**
No login, link, preview, seed, query, or database push is automatically run by
editing these files.

## Configured users and repeatable setup

`src/features/auth/identities.ts` configures the internal login emails. The seed
`setup_shared_home.sql` uses the matching `email_one` and `email_two` constants
to look up UUIDs in `auth.users` case-insensitively:

- `ben@cubby.example`
- `partner@cubby.example`

If you change the identity emails, update these same email literals in the seed
and `verify_access.sql`; local tests reject configuration drift. Profile names
in the seed should match the identity display names. Internal emails are
browser-visible identifiers, not secrets. Passwords never belong in these files.

Setup requires exactly one existing Auth account for each distinct email and
fails transactionally if either is missing or ambiguous. It creates/updates the
two profiles, reuses or generates one home, and adds exactly the two memberships.
Reruns with those same users do not duplicate data. Multiple homes or unexpected
membership abort setup rather than silently expanding access. The browser
resolves its own home; no frontend home ID env variable is needed.

## After link confirmation — preview before any application

Inspect the linked project's migration history, then run:

```powershell
supabase migration list --linked
supabase db push --dry-run --linked --include-seed
```

The dry-run previews pending migrations without applying them; it is not a
substitute for executing SQL tests. Review the project and pending files before
approving an application. The intended order is:

1. `migrations/202609150001_shared_home.sql` — schema, constraints, triggers,
   explicit grants, and RLS.
2. `setup_shared_home.sql` — configured as the seed in `config.toml`.
3. `verify_access.sql` — separate rollback-only security probe.

If Phase 3 schema was already applied manually but is absent from CLI history,
**stop and reconcile the existing schema/history first**. Do not blindly push,
repair history, use `--include-all`, or reset the linked database.

Only after explicit approval of the reviewed dry-run:

```powershell
supabase db push --linked --include-seed
supabase db query --linked --file supabase/verify_access.sql
```

Both flags and the SQL file query are supported by the installed CLI version.
The seed should appear in the preview/application output. If a seed is skipped
because of existing seed history, inspect that history/output first; the
idempotent setup can be explicitly rerun, after approval, with:

```powershell
supabase db query --linked --file supabase/setup_shared_home.sql
```

Do not run setup without first previewing the pending schema migrations.
Do not use `db reset --linked`, `config push`, or service-role credentials.

## API privileges and RLS

Keep the Data API enabled with `public` exposed and `private` unexposed. Keep
automatic table grants disabled. Explicit grants in the migration enable only
the required authenticated reads and furniture/placement column writes/deletes.
Profiles, homes, and memberships are admin-managed/read-only through the API.

Access requires the caller's `auth.uid()` to appear in `home_members` for the
row's home ID. Both approved users share the same home, roster, profiles,
furniture, and placements; anonymous users and non-members cannot read or write
shared data. A narrow private postgres-owned boolean function avoids recursive
membership policies. Frontend queries still use the existing publishable-key
session client and pass through RLS. Ownership/home/timestamp update fields
cannot be spoofed through the API.

The verification SQL resolves users by the same emails, switches to API roles,
tests anonymous/member/non-member access and writes, and rolls back all probe
data. It does not create Auth users or touch existing furniture. Execute the
entire file; if it fails, its transaction must be rolled back.

After an approved push and successful verification, run `pnpm dev` and open
`/room` as each identity. Both should load the same seeded home name and retain
the existing 3D scene. This checks the actual frontend/Data API/JWT path.

## Local verification and scope

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Tests execute committed SQL in isolated in-memory Postgres (test-only PGlite),
plus auth/home-helper regressions. No hosted project is contacted. No lint
script is currently configured. A full local Supabase stack is not required;
the hosted seed assumes the two manually created accounts already exist.

All schema/setup SQL and CLI config belong in source control. Changing already
applied schema requires a NEW versioned migration; do not edit applied schema
history. Seed changes can be committed and explicitly rerun after preview/review.
No editor, furniture UI, placement UI, or realtime work belongs in this change.

Official references: [CLI migration workflow](https://supabase.com/docs/guides/deployment/database-migrations),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), and
[explicit API grants](https://supabase.com/docs/guides/api/securing-your-api).
