# Migration workflow (post-2026-04-29)

Migrations are now tracked via Supabase CLI's
`supabase_migrations.schema_migrations` table. Adopted as part
of the post-audit fix session that closed Audit 4 P4.3.

## Creating and applying a new migration

```bash
# 1. Create a new migration file with the canonical name format
supabase migration new <name>

# 2. Edit the new file in supabase/migrations/<timestamp>_<name>.sql

# 3. Apply to the linked Supabase project (uses SUPABASE_DB_URL)
supabase db push
```

The CLI will:

- Generate a `YYYYMMDDHHMMSS_<name>.sql` file in `supabase/migrations/`
- Apply only the migrations not yet in `supabase_migrations.schema_migrations`
- Insert the new row(s) into the tracker on success

## Initial setup for a fresh checkout

```bash
# Install CLI (one-time)
brew install supabase/tap/supabase

# Authenticate (one-time, opens browser)
supabase login

# Link to the project (one-time per checkout)
set -a && source .env.local && set +a
DB_PASS=$(echo "$SUPABASE_DB_URL" | sed -nE 's|^postgres(ql)?://[^:]+:([^@]+)@.*|\2|p')
PROJECT_REF=$(echo "$NEXT_PUBLIC_SUPABASE_URL" | sed -E 's|https://([^.]+)\..*|\1|')
supabase link --project-ref "$PROJECT_REF" -p "$DB_PASS"
```

## Verifying migration state

```bash
# Show local vs remote migration state
supabase migration list -p "$DB_PASS"

# Both columns should show every migration timestamp;
# any "Local only" or "Remote only" row indicates drift.
```

## Legacy `apply-migration.ts` script

`scripts/apply-migration.ts` is preserved for emergency
fallback (e.g., if the CLI is unavailable in a particular
environment). It applies a single SQL file via direct `pg`
connection but does NOT update the tracker. **Avoid using it
for new migrations** — the resulting drift between filesystem
and tracker will silently break `supabase db push`.

If `apply-migration.ts` must be used, follow up with:

```bash
supabase migration repair --status applied <version> -p "$DB_PASS"
```

…to reconcile the tracker.

## Naming format

The CLI requires `YYYYMMDDHHMMSS_<name>.sql`. The
`HHMMSS` portion must be unique per day to avoid version
collisions (one collision was discovered and resolved during
adoption: `20260429000001_demo_requests` vs
`20260429000001_fix_handle_new_user`; the latter was renamed
to `20260429000002_*`). When creating a migration manually,
use the full 14-digit timestamp; when using `supabase
migration new <name>`, the CLI generates a unique stamp
automatically.

## Future improvements (cross-references)

- **CI integration** (Audit 5 P5.5): add `supabase db push` to
  a GitHub Actions workflow on push to `main` so the
  production tracker stays current automatically. Track in
  Fix 4 of the post-audit fix session.
- **Schema delta verification** (Audit 4 follow-up): the
  `supabase db diff` command requires Docker Desktop for its
  shadow-DB comparison engine; running it as part of CI
  requires Docker availability in the runner. Until then, rely
  on the count-based snapshot comparison documented in
  `docs/audits/2026-04-29-audit-4-schema-db.md`.
