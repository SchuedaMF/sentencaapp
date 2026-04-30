<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Memory

Last updated by Codex on 2026-04-28.

This file is the operational memory for `C:\Users\jur.david\Documents\sentencarj_app`. Use it before rediscovering project history. It summarizes what Codex already built, why it exists, and which local patterns should be preserved.

## Repo Reality

- This folder currently does not appear to be a Git repository from the shell. Do not rely on `git log` or `git status` for project history unless a `.git` directory is restored later.
- Stack: Next.js `16.2.4`, React `19.2.4`, TypeScript, Tailwind CSS v4, Supabase Auth/Postgres/RLS, Vercel, `xlsx` import scripts, `lucide-react`, and `recharts`.
- Keep using App Router patterns already in `src/app`. Next.js 16 has changed APIs here: inspect `node_modules/next/dist/docs/` before changing framework-facing code.
- The app can run with Supabase env vars or fall back to demo/sample data. Never copy or expose `.env.local`.

## Product Intent

- App name/context: "Cumprimento RJ - Sentenca".
- Goal: replace the previous AppSheet/Excel operation with a web app for sentence fulfillment and quality workflows.
- Main operational stages are `CUMPRIMENTO` and `QUALIDADE`.
- Core users are operators, managers, and admins working daily through dashboard, queue, case detail, events, and imports.

## Timeline Of Work Already Done

- 2026-04-27: Supabase MCP and Vercel access were checked/configured for this workspace.
- 2026-04-27: Initial Next/Supabase app was created from `Base RJ - Sentenca.xlsx`, with schema, import pipeline, login, RLS, admin bootstrap, and production deployment.
- 2026-04-27: Admin/manager configuration UI was added so permitted users can create operators.
- 2026-04-27: `/cumprimento` and `/qualidade` were replaced by a faster unified `/fila` experience with stage switching, status chips, pagination, and queue RPCs.
- 2026-04-27: Daily-operator UX improvements were added: clickable table rows, better navigation back to the queue, event list on the case page, event modal, and visual cleanup.
- 2026-04-27: Dashboard was simplified, then later evolved into role-aware production metrics.
- 2026-04-28: Event recomputation was fixed in the database so editing/deleting/inserting events updates sentence operational state.
- 2026-04-28: Batch responsible assignment was added for admins/managers with selected-page and all-filtered modes.
- 2026-04-28: Historical sentence event import was added with `affects_operational_state` so old imported events can be preserved without rewriting current sentence state.
- 2026-04-28: Rule added: creating/recomputing a `QUALIDADE` `ENTREGUE` event also closes `CUMPRIMENTO` as `ENTREGUE` when needed.
- 2026-04-28: Event `pendencia` and `area` values were standardized through app helpers and a migration, preserving support for known aliases and custom areas.
- 2026-04-28: Salesforce order import/table/summary flow was added. Order summaries now appear in case detail and, for `QUALIDADE`, in queue rows instead of the stage date.
- 2026-04-28: Several UI details were tuned: event title copy button, event date input, reduced fields on the case page, default queue status `EM ANDAMENTO`, and quality queue order counts/open-order indication.

## Domain Rules To Preserve

- README source-of-truth fields from the old base are:
  - `STATUS_CUMPRIMENTO`
  - `STATUS_QUALIDADE`
  - `DATA_CUMPRIMENTO`
  - `DATA_QUALIDADE`
  - `DATA_ULTIMO_EVENTO`
- App/domain types live mainly in `src/lib/types.ts`.
- Runtime sentence columns use normalized names such as `cumprimento_status`, `qualidade_status`, `cumprimento_data`, `qualidade_data`, and `data_ultimo_evento`.
- Old fields without underscores and `DATA_PENDENTE` should remain only in raw import payloads/audit context, not as operational truth.
- Roles are `admin`, `gestor`, and `operador`.
- Admins and managers can manage users, see broader operation metrics, and perform batch assignment.
- Operators are scoped to their own responsible name in operational views. Keep the existing responsible scoping in `src/lib/request-context.ts` and `src/lib/data.ts`.
- `QUALIDADE` queue items should only be operationally assignable/visible as ready when fulfillment state allows it, especially when `cumprimento_status` is `ENTREGUE`.
- Batch assignment eligibility is intentionally conservative: `ESTOQUE` and `EM ANDAMENTO`; for `QUALIDADE`, the sentence must have `CUMPRIMENTO` delivered.
- Event changes are the source of operational status transitions. Preserve database trigger/recompute behavior instead of duplicating state logic only in React.
- Historical imported events should not accidentally change current state. Use `affects_operational_state` for that distinction.
- Event title pattern in the UI is currently `ETAPA - TIPO_EVENTO - tipo_decisao_normalized - processo`; the copy button copies that displayed title.
- Salesforce orders are imported as latest/current rows and grouped by process/order key for display. Queue quality rows summarize total orders and whether all are closed or some remain open.

## Important Files And Patterns

- `src/lib/data.ts`: central server-side data access, Supabase RPC usage, sample-data fallbacks, dashboard metrics, queue queries, Salesforce summaries.
- `src/app/actions.ts`: Server Actions for login/logout, event create/update/delete, batch assignment, and user creation.
- `src/lib/queue.ts`: queue URL parsing/building, default status handling, cursor parsing, status ordering.
- `src/lib/event-taxonomy.ts`: canonical options and aliases for event `pendencia` and `area`.
- `src/lib/request-context.ts`: current profile, manager/operator scoping, Supabase request context.
- `src/lib/supabase/admin.ts` and `src/lib/supabase/server.ts`: Supabase clients. Do not leak service-role usage into client components.
- `src/app/(authenticated)/fila/page.tsx` and `src/components/operational-queue.tsx`: unified queue shell.
- `src/components/bulk-assignment-queue.tsx`: batch assignment UI and eligibility expectations.
- `src/app/(authenticated)/sentencas/[id]/page.tsx`, `src/components/event-panel.tsx`, and `src/components/event-form.tsx`: case detail and event workflow.
- `src/components/salesforce-orders-panel.tsx` and `src/components/order-summary-cell.tsx`: Salesforce order display.
- `supabase/migrations/`: database history. Add new behavior with a new timestamped migration; do not edit old migrations unless explicitly asked.
- `scripts/*.mjs`: import, seed, and sync utilities. Keep script behavior idempotent or previewable where possible.
- `outputs/`: generated previews, dry-run reports, and screenshots. Useful for inspection, not source of truth.

## Database And RPC Memory

- Initial schema includes `profiles`, `import_batches`, `sentences`, `service_types`, `sentence_services`, `sentence_events`, `attachments`, and `import_errors`.
- Important later additions/functions include:
  - `sentence_stage_filter_counts`
  - `operational_queue_summary`
  - `operational_queue_items`
  - `operational_queue_items_v2`
  - `dashboard_metrics`
  - `recalculate_sentence_event_state`
  - `apply_sentence_event`
  - `salesforce_orders`
- Performance work added indexes for queue filtering, keyset/cursor pagination, dashboard metrics, search, event dates, and Salesforce order lookups.
- RLS is enabled. Keep policies aligned with role/responsible access, and prefer server-side/RPC enforcement for operational data.

## Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Import sentences: `npm run import:sentencas -- "C:/Users/jur.david/Documents/Base RJ - Sentenca.xlsx"`
- Import events dry run: `npm run import:eventos:dry-run`
- Import events: `npm run import:eventos`
- Import Salesforce orders dry run: `npm run import:salesforce-orders:dry-run`
- Import Salesforce orders: `npm run import:salesforce-orders`
- Create/promote admin: `npm run seed:admin -- email@example.com "temporary-password" "Full Name"`
- Seed current team: `npm run seed:team`
- Sync operators from spreadsheet: `npm run sync:operators -- caminho/usuarios.xlsx`
- Apply Supabase migrations to linked remote: `npx supabase db push`

## Operational Safety

- Do not commit, print, or document secrets, tokens, service-role keys, `.env.local` values, or temporary production passwords.
- Do not add real credentials to this file. If a credential is needed, point the user to Supabase/Vercel/admin tooling instead.
- When documenting people or team membership, prefer pointing to the relevant script as source of truth instead of duplicating full staff lists here.
- Verify production deployments separately from local builds when the user asks for deploy. Previous sessions had preview-vs-production confusion, so confirm the final production URL responds.
- For docs-only edits like this file, do not run build/lint unless needed. For app or database behavior changes, run the smallest meaningful verification and mention any skipped checks.
