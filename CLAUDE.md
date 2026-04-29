# CLAUDE.md

This file is auto-loaded by Claude Code at session start.

## Required reading before any work

1. **`docs/allocus-mission-and-context.md`** - Strategic context, mission, 4-month roadmap, current build state. Read first.

2. **Latest journal entry** in chat history or `docs/sprint-summary-*.md` - what was last worked on, where things stand.

3. **`docs/audits/2026-04-28-platform-audit-summary.md`** - Open audit findings and severity calibration.

## Operating rules

- Plain language, short sentences, no em dashes (use hyphens)
- One Terminal command at a time, paste output between
- User pushes commits manually unless explicitly told otherwise
- psql not installed - use Node.js pg pattern: `set -a && source .env.local && set +a`
- NULL is honest disposition - never default to a value when the truth is unknown
- Pattern check after every defect resolution
- Audit doc updates dated at moment of resolution

## What to do if confused or context is unclear

Stop and ask the user. Do not proceed with assumptions on strategic decisions. Tactical decisions can be made and flagged.
