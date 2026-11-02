# Ephemeral plans

Status: draft for review · 2026-11-02 · branch `feat/supabase-auth`

Review basis: the owner's brief for this change; the app shell spec (`2026-11-01-app-shell-and-agent-persona-design.md`) and the report side panel spec (`2026-11-01-report-side-panel-design.md`), both with their Build notes; the supabase auth spec (`2026-10-31-supabase-auth-design.md`); the source at `2a66af8`; and the live Supabase project `dwiuzfvmevdzzabqeaog`, read only (row counts, indexes, functions, policies and triggers of `workspace_entities`). Decisions marked **builder's call** are mine, made where the brief left room. Everything else comes from the owner's brief.

## Decision record

The owner decided that carts, trips, events, shortlists and other plan widgets are working state for one conversation. In the owner's words:

- "A cart from yesterday has stale prices and an outdated query, and the user simply re-asks."
- "There is no checkout."
- Saved cards in past messages exist only to "structurally hold the chat together", not to be acted on.
- "Memory is for preferences, not operational state."

Reports are different. They are finished documents and stay exactly as they are: the `artifacts` table, Storage, the Reports section and the report panel.

So the Plans section goes away, the agent stops writing plan entities to the database, and plan state lives in two places only: the live agent session's memory, and the chat transcript (`chat_messages.parts`) that already holds every card the user saw.

## Goals

- No Plans section anywhere: rail, phone tabs, routes, web API, agent endpoints, route parsing, tests and types.
- The agent never reads or writes `workspace_entities` at runtime. The table and its two functions stay in the database untouched until the owner confirms the drop.
- In-session behaviour is unchanged. The user can change quantities, swap picks and remove items on the latest cart, and change guests, dates and budget on the latest event or trip. The agent's `shop` and `plan` follow-ups ("make it 16 kids", "add tortillas") keep working.
- When the agent session is recreated (container restart, 30-minute idle sweep, per-user session cap, or a persona change through `retireUser`), the chat's current cart and plans are rebuilt from the transcript. The model is told that rebuilt prices are old.
- Cards from earlier sessions are visibly read-only and dated, with a one-click way to refresh the cart.

## Non-goals

- Dropping `workspace_entities`, `workspace_put` or `workspace_counts`. The SQL is written here and is applied only after the owner confirms (see "Follow-up migration").
- Migrating existing saved plans into transcripts. They stop being shown (see "Rollout").
- Cross-chat plans, a list of past carts, or search over plan contents.
- Any change to reports, the report panel, `artifacts` or Storage.
- Rewriting the downloadable architecture explainer page in `~/Downloads`. The owner handles that separately; "Architecture explainer notes" below gives the replacement text.

## Anti-goals (failures even if it works)

- A card from an earlier session shows enabled quantity, swap or remove controls.
- A rebuilt cart silently comes back after the user emptied it or started a new one.
- An older card is rebuilt because the newest one was malformed or missing from the transcript.
- The model quotes a rebuilt cart's total as current without saying when the prices are from.
- Any runtime code path calls `workspace_entities`, `workspace_put` or `workspace_counts`.
- Agent-only transcript parts (edits, state markers) reach the browser.

## Verified facts

| Fact | Where |
|---|---|
| Live: `workspace_entities` holds 6 rows for 1 user (5 carts, 1 event). Indexes: `workspace_entities_pkey`, `workspace_entities_chat_user_idx`, `workspace_entities_user_recent_idx`. Functions: `workspace_put(uuid, uuid, text, text, jsonb, integer)` and `workspace_counts(uuid)`. No policies and no triggers on the table. | Supabase, read-only query |
| Every widget the user sees is emitted by the translator as a synthetic `show_widget` tool call with id `<toolCallId>-widget` and args `{"widget": …}`. This covers cards from tool `details.widget` (plan) and from `details.data` (shop → `cart`). | `agent/src/agui/translate.ts` `widgetCall`, `toolEnded` |
| The transcript saves `show_widget` args **verbatim** (`savedArgs` returns `raw` for `show_widget`), so a saved cart or plan card is complete. Tool results are clipped to 2,000 characters, but widget cards don't depend on them. | `agent/src/agui/transcript.ts` |
| If the parts exceed 500,000 characters, the transcript drops every `show_widget` part and keeps text and reports. | `transcript.ts` `parts()` |
| Within one run, a data-rendered widget kind is shown only once (`renderedKinds`). A second `shop` call in the same turn changes the cart but shows **no** card. | `translate.ts` `widgetFor` |
| An emptied cart (`shop` → "The cart is empty.") and a `shop` call that found nothing show no card. | `tools/shop.ts`, `render/registry.ts` (`summary.length === 0` → `null`) |
| A cart card stores lane **labels** (`"Safeway (via Instacart)"`) as store names. The `ActiveCart.stores` ids (`"instacart"`) that `shop` needs for "add tortillas" are not in the card. | `tools/shop.ts` `storeResults`, `render/cart.ts` `toCartStore` |
| `plan set` and `plan patch` always show a card. `PlanSchema` reuses the entity schemas that `validateEntity` has already checked. | `tools/plan.ts` `planResult`, `shared/widgets.ts` |
| UI edits travel as the AG-UI context item `workspace_edits` with the next user message. `runTurn` applies them to `entry.cart` and, through `applyEntityEdits`, to the latest event or trip. No card is emitted for them. | `agui/runHandler.ts`, `workspace/edits.ts`, `web/components/chat/ChatSession.tsx` |
| `RunContext.workspace` is a **second** `SupabaseWorkspaceStore` built per run in `server.ts`, separate from the one inside the session. Today the two agree only because both hit the database. | `agent/src/server.ts` `runContext` |
| On a new session, `handleRun` loads the last 200 messages (`messages.history`, rows with `parts`) and passes text-only history to `getOrCreate`. The user's row for the current run is written **after** the session is created. | `runHandler.ts` `seedHistory`, `persist` |
| History rows reach the web through `GET /chats/:id/messages` with `parts` as stored. `toHistory` ignores parts on user rows. | `agent/src/http/chats.ts`, `web/lib/chats.ts` |
| The web marks an earlier cart in the same pane as replaced ("Updated cart below") and locks it. `CartCard` and `PlanCard` both use `locked = stale \|\| !onEdit`. Locked `CartCard` today still renders the stepper (disabled). | `web/components/widgets/CartCard.tsx`, `PlanCard.tsx`, `TurnView.tsx` |
| A `ChatPane` unmounts when its thread is neither active nor running (`mountedIds`), and remounts by reloading history. CopilotKit can keep the agent's messages across a remount (`ChatSession` only calls `setMessages` when the agent has none). | `web/lib/shell/chatController.ts`, `ChatSession.tsx` |
| Unknown shell paths already render the shell's not-found page (`app/(app)/[...missing]/page.tsx` → `notFound()` → "This page doesn't exist." with "Back to chat"). `safeNext` maps any path `parseRoute` rejects to `/`. | `web/app/(app)/`, `web/lib/auth.ts` |
| Search scopes are `all`, `chats` and `reports`. Plans were never searchable, and `scope=plans` is already a 400. | `shared/lists.ts`, `agent/src/http/search.ts`, `web/test/api/routes.test.ts` |
| `cartWidget` (`render/cart.ts`), `entityKey`/`entityIdFromKey` (`shared/workspace.ts`), `PlanSummary`/`PlanCounts`/`PlansResponse`/`PLANS_PAGE_SIZE` (`shared/lists.ts`), `EntityCounts`/`ChatEntity` (`db/types.ts`) and `ChatRepo.titles`'s plans caller are used only by the Plans section. `ChatRepo.titles` is also used by reports and search, so it stays. | grep across `agent/`, `web/`, `shared/`, `e2e/` |

## Decisions at a glance

| Topic | Decision |
|---|---|
| Removed routes | **Not found**, not a redirect. `/plans` and `/plans/…` fall through to the existing shell not-found page. Signed-out `?next=/plans` lands on `/` because `parseRoute` rejects it. Why: the feature is gone, not moved. A redirect would be code to keep forever, and it would hide the removal behind a page the user didn't ask for. The section existed for about a day with one real user, and the not-found page already offers "Back to chat". |
| Phone tabs | Chat · Search · Reports · You (still 4 columns). Search moves out of the drawer into a tab, so the tabs match the rail (Chats, Search, Reports). It stays in the drawer too. |
| Where plan state lives | `SessionEntry.workspace` (a `MemoryWorkspaceStore`) and `SessionEntry.cart` (`ActiveCart`), both created by `sessionFactory`. `RunContext.workspace` is removed. |
| Rebuild source | The newest cart card and the newest card per plan `(entity, id)` in the loaded transcript window. UI edits saved on later user rows are replayed onto them. A later state marker cancels a cart or all plans. |
| Agent-only parts | Two new `tool`-type part names, never sent to the browser: `workspace_edits` (on user rows) and `working_state` (on assistant rows). |
| Cart store ids | The cart card gains an optional `storeIds: string[]` (the `ActiveCart.stores` ids) so a rebuilt cart can take follow-ups. Older cards without it are not rebuilt (**legacy**). |
| Per-run cart dedupe | Removed for `cart` only. Each `shop` call that finds products shows its card, so the newest card is always the cart's real state. Other kinds keep the dedupe. |
| Live vs locked | A card is live only if it arrived by a run streamed into **this mounted pane** and is the newest card of its kind (cart) or of its `(entity, id)` (plan). Everything else is locked. |
| Refresh | A one-click **Refresh prices** chip on the newest cart card when it is locked (**builder's call**: it is one button in the existing follow-up chip style and sends a visible message). Plans get the dated line only. |
| Price refresh in the agent | `shop` gains `refresh: true`, which re-checks every item at the cart's stores. Today there is no way to re-price items already in the cart. |
| `database.types.ts` | Unchanged. It is generated from the live schema, where the table and functions still exist. It is regenerated by the follow-up migration's PR. |
| RLS integration checks on the table | Kept until the drop. They assert the security posture of objects that still exist. |
| Follow-up migration | SQL is in this spec only. The builder must not add it to `supabase/migrations/` (where `db push` would apply it). |

## Removal list

### Web

Delete:

- `web/app/(app)/plans/page.tsx`
- `web/app/(app)/plans/[chatId]/[kind]/[key]/page.tsx` (and the now-empty `web/app/(app)/plans/` tree)
- `web/app/api/plans/route.ts`
- `web/app/api/plans/[chatId]/[kind]/[key]/route.ts` (and the now-empty `web/app/api/plans/` tree)
- `web/components/plans/PlansView.tsx`, `PlanKindFilter.tsx`, `PlanRow.tsx`, `PlanDetail.tsx` (the whole `web/components/plans/` directory)
- `web/lib/plans.ts`

Change:

- `web/components/shell/Rail.tsx`: remove the `rail-plans` `RailLink` and the `SquareCheckBig` import.
- `web/components/shell/MobileTabs.tsx`: replace `mobile-tabs-plans` with `<Tab id="mobile-tabs-search" href="/search" label="Search" icon={Search} active={section === "search"} />`, placed between Chat and Reports. The grid stays `grid-cols-4`.
- `web/components/shell/MobileTopBar.tsx`: remove the `plans` and `plan` title entries.
- `web/lib/shell/useRoute.ts`: `NavSection` becomes `"chat" | "search" | "reports"`. Remove the `plans`/`plan` cases.
- `web/components/shell/ShellOverlays.tsx`, `AccountSheet.tsx` and `MobileDrawer.tsx`: remove any Plans item or section title, if present (builder confirms by grep; the first grep showed only the files listed above with Plans links).
- `web/components/widgets/CartCard.tsx` and `PlanCard.tsx`: see "Card UI". `CartCard` is still used by the chat, so it is not deleted. Only its read-only plan-detail usage (`toolCallId="detail-…"`) goes away with `PlanDetail`.
- `web/lib/steps.ts` `planLabel`: "Saved/Saving the event" becomes "Updated/Updating the event" (set and patch). "Read/Reading" stays for `get`.
- `web/test/shell/sections.test.tsx`: delete the `PlansView and PlanDetail` block and its imports and fixtures.
- `web/test/api/routes.test.ts`: delete the two plans imports, the `plans page` and `plans kind` 400 cases and the two forwarding asserts. Keep `search scope … scope=plans → 400`.
- `web/test/auth/safeNext.test.ts`: remove the `/plans…` round-trip cases. Add `safeNext("/plans", ORIGIN)` → `/` and `safeNext("/plans/<uuid>/trip/dDE", ORIGIN)` → `/`.
- `web/test/shell/focus.test.tsx`: replace `go("/plans")` with `go("/reports")` (it only needs a non-search section).
- `web/test/widgets/plan.test.tsx`: update the `stepLabel` expectations to "Updated the event" and "Updating the event".

### Shared

- `shared/routes.ts`: remove the `plans` and `plan` `Route` variants, their `parseRoute` case (so `/plans…` → `null`), their `hrefFor` cases, and the `EntityKind`, `entityIdFromKey` and `isEntityKind` imports.
- `shared/lists.ts`: remove `PLANS_PAGE_SIZE`, `PlanSummary`, `PlanCounts`, `PlansResponse` and the `EntityKind` import.
- `shared/workspace.ts`: remove `entityKey`, `entityIdFromKey`, `B64URL`, `KEY_RE` and `ENTITY_ID_MAX`. Keep the entity schemas, `ENTITY_KINDS`, `isEntityKind`, `PLAN_KINDS`, `isPlanKind`, `validateEntity`, `applyPatch`, the edit schemas, `parseWorkspaceEdits` and `safeHttpUrl` (all used in the chat).
- `shared/widgets.ts`: `CartSchema` gains `storeIds: Type.Optional(Type.Array(Str, { maxItems: 10 }))`.
- `shared/chats.ts`: add `export const EDITS_PART = "workspace_edits"`, `export const STATE_PART = "working_state"` and `export const AGENT_PARTS: ReadonlySet<string> = new Set([EDITS_PART, STATE_PART])`. Add a `WorkingStateArgs = { cart?: "unshown"; plans?: "unshown" }` type.

### Agent

Delete:

- `agent/src/http/plans.ts`
- `agent/src/plans/view.ts` (the `agent/src/plans/` directory)
- `agent/test/http/plans.test.ts`, `agent/test/plans/view.test.ts`, `agent/test/fixtures/plans.ts`

Change:

- `agent/src/app.ts`: remove the `planRoutes` import and mount, and `"/plans"`, `"/plans/*"` from `USER_PATHS`. The `lists` rate limit stays (reports use it).
- `agent/src/server.ts`: `runContext` no longer builds a `SupabaseWorkspaceStore`. Remove the import.
- `agent/src/db/types.ts`: remove `WorkspaceRepo`, `ChatEntity`, `EntityCounts`, the `workspace` field of `UserRepos`, and the `EntityKind` import if unused. `VersionedEntity` moves to `agent/src/workspace/store.ts` (its only users are the store, the plan tool and edits).
- `agent/src/db/users.ts`: remove `EntityRow`, `toEntity`, `CountsSchema`, `workspace()`, the `workspace:` entry in `forUser`, and the imports of `PLANS_PAGE_SIZE`, `ENTITY_KINDS`, `VersionConflict` and `WorkspaceRepo`.
- `agent/src/render/cart.ts`: remove `cartWidget` (Plans-only). Add `cartFromWidget` (see "Session rebuild").
- `agent/src/workspace/store.ts`: remove `SupabaseWorkspaceStore`. `MemoryWorkspaceStore` becomes the only implementation (see "Session state").
- `agent/src/workspace/cart.ts`, `agent/src/agui/runHandler.ts`, `agent/src/agui/transcript.ts`, `agent/src/agui/translate.ts`, `agent/src/session/sessionStore.ts`, `agent/src/session/createSession.ts`, `agent/src/http/chats.ts`, `agent/src/tools/shop.ts`, `agent/src/tools/plan.ts`, `agent/src/render/registry.ts`: see the sections below.
- New `agent/src/workspace/rebuild.ts`.
- `agent/src/db/database.types.ts`: **no change** (see "Database").

Tests to delete or reduce:

- `agent/test/db/repos.test.ts`: delete "maps PT409 from workspace_put…" and "counts plans per kind…".
- `agent/test/fixtures/memoryRepos.ts`: remove the `workspace` repo, the `PLANS_PAGE_SIZE`, `ENTITY_KINDS`, `EntityKind`, `EntityCounts` and `VersionConflict` imports and the entity rows.
- `agent/test/supabase/repos.int.test.ts`: delete the workspace half of "claims chats for their owner only and keeps workspace versions in step" (keep the claim checks), and the `workspace.page`/`workspace.counts` lines of "reads one chat, chat titles, reports with their chats and plans across chats" (renamed "…reports with their chats").
- `agent/test/workspace/store.test.ts`: delete the Supabase parameterisation, "never writes into another user's chat" and "keeps the database's kind check in step with ENTITY_KINDS". Keep the memory-store cases.
- `agent/test/shared/routes.test.ts`: remove the `/plans…` round trips and the plan-key cases. Add `parseRoute("/plans")` and `parseRoute("/plans/<uuid>/trip/dDE")` → `null`.
- `agent/test/shared/lists.test.ts`: delete the `entityKey` block. Keep the `safeHttpUrl` cases.
- `agent/test/render/cart.test.ts`: unchanged (it covers `renderData`). Add the `storeIds` and `cartFromWidget` cases below.
- `agent/test/agui/workspace.test.ts` and `agent/test/workspace/followup.test.ts`: rewritten against the session-held store (see "Testing").
- `agent/test/supabase/rls.int.test.ts`: **kept** as is (see "Database").

### E2E

- `e2e/app-shell.demo.spec.ts`: remove the local `entityKey`, step 7, the two `/plans` deep links in step 8, `/plans` from the axe paths in step 9, and `#mobile-tabs-plans` in step 13. Rename the test title to drop "plans". Add the steps in "Testing → E2E".
- `e2e/support/seed.ts`: remove `SEED.plans`, `TRIP_ID`'s entity row and the whole `workspace_entities` insert. Add transcript cards (see "Testing → E2E").

### Docs

- `README.md` line 83 ("Workspace and chats"): replace with "Chats and their messages are saved in Supabase, and a chat continues after an agent restart. Carts, trips, events and shortlists are working state for the conversation: they live in the agent's session, and if the session restarts, the chat's latest cards rebuild them. Cards from earlier sessions are read-only and dated." Remove the Plans view from the paragraph that lists the sections.
- `CONTRIBUTING.md` lines 86–93: remove `/plans` and `/plans/[chatId]/[kind]/[key]` from the routes list and `components/plans/` from the section views.

## Session state

`SessionEntry` gains `workspace: WorkspaceStore` (required) next to the existing `cart?: ActiveCart`. `RunContext.workspace` is removed. `runTurn` applies edits to `entry.workspace` and `entry.cart`, and adds `await entry.workspace.summary()` to evidence. This also fixes the split-brain the current code only avoids by hitting the database twice.

`MemoryWorkspaceStore` (in `agent/src/workspace/store.ts`):

- `VersionedEntity` gains `restoredFrom?: string` (ISO time of the message that held the card it was rebuilt from).
- `seed(rows: Array<{ kind; id; value; version; restoredFrom }>)`: inserts in the given order, keeping each row's `version` and giving increasing `updatedAt`, so `list()` order (and `applyEntityEdits`'s "latest of a kind") matches the transcript.
- `put(kind, id, value, expectedVersion?, opts?: { keepRestored?: boolean })`: clears `restoredFrom` unless `keepRestored` is set. The plan tool's `set`/`patch` clear it. `applyEntityEdits` passes `keepRestored: true` because a guest-count change doesn't make prices current.
- `summary()`: a restored entity's line ends with ` (from a card shown <YYYY-MM-DD>)`. The 600-character cap is unchanged.

`ActiveCart` gains `restoredFrom?: string`. `start()` clears it. The `shop` tool clears it after a call that searched every item in the cart (`fresh` true, which includes `refresh`). `applyEdits` leaves it.

`workspaceCart(store, restored?)` (in `workspace/cart.ts`) loads the rebuilt cart entity (if any) into a new `ActiveCart`, sets `restoredFrom`, and keeps `onSave` writing `("cart", "main")` into the memory store. That keeps `plan get kind:cart` and the summary working through one path. The memory store's cart row is a mirror only; the `ActiveCart` is the source.

`sessionFactory` builds `new MemoryWorkspaceStore()`, seeds it from the rebuild, and puts both `workspace` and `cart` on the returned entry. The `repos.workspace` use is gone.

## Saving what the rebuild needs

### UI edits on the user row

`handleRun` reads `readWorkspaceEdits(input)` **before** it persists the user row, and passes the parsed edits to `runTurn` (which stops reading them itself). When edits are present, the user row is written with:

```json
"parts": [
  { "type": "text", "text": "<prompt>" },
  { "type": "tool", "id": "edits-<runId>", "name": "workspace_edits", "args": "<JSON of the parsed WorkspaceEdits>" }
]
```

`content` is unchanged, so search, `historyFromStored` and titles are unaffected. Only parsed (`parseWorkspaceEdits`) edits are stored.

### State markers on the assistant row

`Transcript` also watches `TOOL_CALL_START` for `shop` (it does not save the call itself). When `parts()` is built, each `shop` call **without** a following `show_widget` part whose id is `<shopCallId>-widget` adds, at that call's position:

```json
{ "type": "tool", "id": "<shopCallId>-state", "name": "working_state", "args": "{\"cart\":\"unshown\"}" }
```

This covers an emptied cart, a new cart that found nothing, a store switch that found nothing, a failed or aborted `shop` call, and a `shop` call inside a codemode script that didn't render. In every one of those the session's cart may differ from the last card. The rule is deliberately conservative: a failed `shop` call that didn't change the cart still cancels the rebuild. The cost is one re-ask; the alternative is silently acting on the wrong cart.

When the 500,000-character fallback drops the `show_widget` parts, it appends `{ "name": "working_state", "args": "{\"cart\":\"unshown\",\"plans\":\"unshown\"}" }`. If even that list doesn't fit (in practice impossible: text is capped at 200,000 and report results at 2,000 each), the last fallback is the text parts plus that marker, never `undefined`. `parts()` no longer returns `undefined` when the run had a marker or edits but no saved tool.

`plan` needs no marker. `set` and `patch` always show a card (verified above), and `get` changes nothing. A test pins "every valid entity yields a valid plan widget".

### No cart dedupe

In `translate.ts` `widgetFor`, the "one card per kind per run" rule skips `kind === "cart"`. Two `shop` calls in a turn show two cart cards. The live UI already marks the first one "Updated cart below". Without this, the newest saved card would lag the real cart every time the model calls `shop` twice in a turn.

### Store ids on the cart card

The `shop` tool's `data` gains `storeIds: cart.stores`. `renderers.shop` copies it to the widget as `storeIds`. The web ignores the field.

### Never sent to the browser

`GET /chats/:id/messages` (`agent/src/http/chats.ts`) strips agent-only parts before responding. On user rows it removes `parts` entirely. On assistant rows it filters out parts whose `name` is in `AGENT_PARTS`, and omits `parts` if none remain. `web/lib/chats.ts` `toHistory` also skips `AGENT_PARTS` names, as a second guard.

## Session rebuild

### When it runs

Whenever `sessionFactory` creates a session for a chat: first run after a container restart, after the idle sweep or the per-user cap dropped the session, and after `retireUser` (persona change). `handleRun` already loads the transcript for a new session. It now passes the stored rows, not only the text history:

- `CreateSession(owner, ctx, persona, seed?: SessionSeed)` where `SessionSeed = { history: HistoryMessage[]; transcript: StoredMessage[] }`.
- `seedHistory` returns a seed whenever the chat has stored rows, even if the text history is empty, because cards can sit on rows with empty `content`.
- The current run's user row is written after the session is created, so its edits are not in the rebuild; `runTurn` applies them once, as today.

### Which parts count

`rebuildWorkingState(transcript: StoredMessage[]): Rebuilt`, a pure function in `agent/src/workspace/rebuild.ts`, walks the rows oldest to newest (the same window of the last 200 rows that `messages.history` returns) and each row's `parts` in order. Rows of status `complete` and `interrupted` both count: an interrupted reply's card was still shown. Rows without `parts` contribute nothing.

```ts
type Restored<T> = { value: T; shownAt: string };
type Rebuilt = {
  cart?: Restored<CartEntity>;
  plans: Array<{ kind: PlanKind; id: string; version: number; value: unknown; shownAt: string }>;
  notes: string[];
};
```

State while walking:

- `cart`: `none | { entity, shownAt } | { lost: reason, shownAt, items }`.
- `plans`: a map from `${entity}\u0000${id}` to `{ … } | { lost: reason }`, plus a touch order.

For each part:

1. **`show_widget` (assistant rows).** Parse `args` as JSON and take `.widget`. Peek at `widget.kind`:
   - Not `cart` or `plan`: ignore.
   - `cart`, and `validateWidget` passes and `cartFromWidget` returns an entity: `cart = { entity, shownAt: row.createdAt }`.
   - `cart`, valid but no `storeIds` (legacy card): `cart = { lost: "legacy", items }`, where `items` is the first store's `query × qty` list.
   - `cart`, unparsable or invalid: `cart = { lost: "malformed" }`.
   - `plan`, valid: set the map entry for `(entity, id)` with its `version` and `value`, and touch it.
   - `plan`, invalid but with string `entity` and `id`: mark that key `{ lost: "malformed" }`. Without them, mark nothing (it can't be attributed) and add one note.
2. **`working_state` (assistant rows).** Parse args. `cart: "unshown"` → `cart = { lost: "unshown", items of the previous cart if any }`. `plans: "unshown"` → mark every plan key lost and stop restoring plans shown before this point.
3. **`workspace_edits` (user rows).** `parseWorkspaceEdits(JSON.parse(args))`. Unparsable → ignore (only parsed edits are ever written, so this means tampering or a bug; it is logged at `warn`). Otherwise:
   - `cart` edits: if the cart is restorable, `ActiveCart.from(entity)`, `applyEdits`, `snapshot()`. The `ActiveCart` has no `onSave` here.
   - `event`/`trip` edits: apply to the most recently touched restorable plan of that kind, merged and kept only if `validateEntity` passes (the same rule as `applyEntityEdits`). Touch it.

The newest card wins. A malformed or unshown newest card never falls back to an older card: the older card is not what the user last saw.

"Locked" is a UI state, not a stored one. Whether the user saw the newest card as live or locked doesn't matter to the rebuild: the newest card is the chat's last known state.

### `cartFromWidget(w: Cart): CartEntity | null`

In `render/cart.ts`. Returns `null` without `storeIds`. Otherwise:

- `stores`: `w.storeIds`.
- `scope`: the card's store names in card order.
- `items`: the first store's `{ query, qty }` in order (every store in a card has the same item list).
- `homes`: `name → url` for stores whose `url` is non-empty.
- `picks`: `name → { normalisedQuery → picks }`, using the same key normalisation as `ActiveCart`. The card keeps at most 3 picks per item, which is all the UI ever offered for a swap.

It must round-trip: `renderData({ kind: "shop", stores: ActiveCart.from(cartFromWidget(w)).view(), summary: bestValue(…) })` yields the same stores, items, picks and totals as `w`.

### Prices are stale, and the model is told

The `<workspace>` context note (`workspace/cart.ts`, renamed `workingNote`) becomes:

```
<workspace>
This chat's working state, for this session only (nothing is saved elsewhere). The user can change the latest cards; trust this over earlier messages.
cart: 3 items at Trader Joe's (best $18 at Trader Joe's) (from a card shown 2026-11-01)
trip t1: Big Sur, 2026-11-14 to 2026-11-16, 2 travelers (from a card shown 2026-11-01)
Restored from earlier cards: prices and availability are from the date shown. Before quoting a total or relying on a price, call shop with refresh: true, or say the prices are from that date.
</workspace>
```

- The last line appears only when something is still restored (`restoredFrom` set on the cart or on any plan). It sits outside the 600-character summary cap.
- Each `notes` entry from the rebuild is one more line, written for the model:
  - legacy or unshown cart with known items: "The last cart card (2026-11-01: corn tortillas ×2, black beans ×4, avocados ×6) can't be continued. If the user means it, start a new cart with those items."
  - malformed cart: "The last cart card couldn't be read, so there is no current cart. If the user refers to it, ask them what they want in it."
  - lost plan: "The last <kind> card (<id>) couldn't be read. If the user refers to it, ask them to restate it."
- The notes are kept on the session (`restoredNotes`) and shown until the next successful `shop` (for cart notes) or `plan set` (for plan notes) of that kind, then dropped.
- When there is no state and no notes, the note is omitted, as today.

### `shop refresh`

`refresh: Type.Optional(Type.Boolean({ description: "re-check every item's price at the cart's stores; use when the user asks to refresh, or the workspace note says the prices are from an earlier date" }))`. In `updateCart`: with `refresh` and a non-empty cart, return `{ added: [], search: cart.items, fresh: true }`. With an empty cart or no stores, fail with "There is no cart to refresh." `refresh` together with `stores` or `new_cart` follows the existing paths (they already search everything).

## Live versus locked

### The rule

In a chat pane, a cart or plan card is **live** only when both hold:

1. **It arrived in this mounted pane.** `ChatSession` adds a card's tool-call id to `arrived: Set<string>` (state) in `onToolCallStartEvent` when `toolCallName === "show_widget"`. Cards that came from `props.history`, or from CopilotKit's cached messages after a remount, are never in `arrived`.
2. **It is the newest of its kind in the pane.** For carts this is the existing `latestCart` (newest cart card across all turns). For plans it is the existing `latestPlans` (newest per `entity:id`).

Every other cart or plan card is **locked**. Within locked:

- **Replaced**: arrived in this pane but not the newest. Keeps today's "Updated cart below" / "Updated plan below" header and 70% opacity.
- **Earlier**: did not arrive in this pane. Shows the dated line (below) at full opacity.

### Why this rule

The browser can't see whether the agent's session still holds a card, and a remounted card has lost its local edit state (quantities the user changed are only in `CartCard` state until sent). Locking on remount or reload is honest: the card shows what was rendered, dated, and the user asks to refresh. This is the owner's example rule made exact. "Everything loaded from history" includes cards CopilotKit kept across a remount, because their local edits are gone too.

### Cases

| Situation | Result |
|---|---|
| A run in this pane shows a cart | Live (newest). The previous cart in the pane becomes replaced. |
| Reload the page | All cards come from history → all locked (earlier). The newest cart offers Refresh. |
| Switch to another chat and back (pane unmounted) | Locked (earlier). The agent session may still be alive; the next message's edits would still apply, but no edit can be made on a locked card, so that doesn't arise. |
| Go to Reports or Search and back (pane stays mounted, `activeId` unchanged) | Unchanged: the pane never unmounted. |
| Resize across breakpoints | Unchanged (same `ChatPane` instance). |
| Two chats running in two mounted panes | Each `ChatSession` has its own `arrived` set and `idPrefix`. Live cards in each are independent. |
| The same chat open in two browser tabs | The tab that ran shows a live card; the other tab's copy came from history → locked. If both tabs ran, each has a live card. Edits are by item query and apply to the one session cart, and the next card shows the result. Documented, not prevented. |
| Agent session recreated while the pane stays mounted (idle sweep with the tab open) | The card stays live. The edit is sent with the next message; the rebuild restores the same card's state (plus earlier replayed edits), and `runTurn` applies the new edit to it. |
| A run fails before showing the card | Nothing arrives; nothing changes. |
| Interrupted run that did show a card | The card arrived → live if newest. |

`latestCart` and `latestPlans` stay as they are. `TurnView` gets `arrived: ReadonlySet<string>` and `shownAt: Readonly<Record<string, string>>` and passes to `WidgetRenderer`:

- `staleCart` / `stalePlan` = replaced (arrived, not newest).
- `lockedAt` = for an earlier card, its `shownAt[id]` or `null` when unknown (cached after a remount).
- `onCartEdit` / `onPlanEdit` only when live.
- `onRefresh` only for the newest cart card when it is earlier-locked and the pane isn't running.

### Card dates

`toHistory` stays a function of `(chatId, items)` returning messages. A new `cardDates(items: StoredMessage[]): Record<string, string>` in `web/lib/chats.ts` maps each `show_widget` part id whose widget kind is `cart` or `plan` to its row's `createdAt`. `Thread` gains `cardDates?: Record<string, string>`, set by the `loaded` action. `ChatPane` passes it to `ChatSession` as `shownAt`.

## Card UI

### `CartCard`

New props: `lockedAt?: string | null` (`undefined` = not earlier-locked; `null` = earlier, date unknown), `agentName: string`, `onRefresh?: () => void`, `now?: Date` (tests).

`locked = stale || !onEdit || lockedAt !== undefined` (the existing rule plus the new state).

When locked (replaced or earlier):

- **No controls.** The quantity stepper is replaced by plain text `×{qty}` (`${rid}-qty-n`, `aria-label="Quantity {qty}"`). No `${rid}-dec`, `${rid}-inc`, `${rid}-swap`, `${rid}-remove`, `${rid}-alts`, `${id}-removed` or `${id}-s…-restore-…` render. Today the stepper renders disabled; that changes for both locked states.
- Store tabs still switch, because they only change what is shown.
- Product links and the "Continue on X ↗" hand-off stay `ExternalLink`s, which render an `a` only for `http:`/`https:` URLs (`safeHttpUrl`). Anything else renders as text. No change; covered by a test for the locked state too.

When earlier-locked, under the header:

- `<p id="${id}-locked-note" class="text-xs text-text-muted">` reading **"Prices from {date} · ask {agentName} to refresh"**, or "Prices may be out of date · ask {agentName} to refresh" when `lockedAt` is `null`.
- With `onRefresh`: `<button id="${id}-refresh" type="button">Refresh prices</button>` in the `Followups` chip style (`rounded-full border border-border bg-paper px-3 py-1.5 text-[13px] text-text-secondary …`), right after the note. It calls `onRefresh`. `TurnView` wires it to `props.onAnswer("Refresh my cart's prices", false)`, a visible user message (not the quiet `answer-` form). Hidden while the pane is running.
- The handoff note "Guest prices for your area. You sign in and check out on X." stays.

### `PlanCard`

Same `lockedAt` and `agentName` props. `locked` gains `|| lockedAt !== undefined`. Earlier-locked plans show `<p id="${id}-locked-note">` **"From {date} · ask {agentName} to update it"** (date unknown: "From an earlier session · ask {agentName} to update it"). No refresh chip. Locked plan fields already render as text or disabled inputs. Disabled inputs become text spans, matching the cart rule ("no controls").

### Date format

`cardDate(iso, locale, now)` in `web/lib/dates.ts`: the same calendar day → time only (`3:10 PM`); the same year → `Nov 1`; otherwise `Nov 1, 2025`. Invalid ISO → treated as unknown (`null` copy).

### Ids

All new elements have ids derived from the card's root id (`widgetId(kind, toolCallId, idPrefix)`, which already includes the pane prefix): `${id}-locked-note`, `${id}-refresh`, `${rid}-qty-n` (now also on the locked text). The new tab is `mobile-tabs-search` with `mobile-tabs-search-icon`.

## UX copy

| Where | Copy |
|---|---|
| Earlier cart, date known | "Prices from {date} · ask {name} to refresh" |
| Earlier cart, date unknown | "Prices may be out of date · ask {name} to refresh" |
| Refresh chip | "Refresh prices" → sends "Refresh my cart's prices" |
| Earlier plan | "From {date} · ask {name} to update it" / "From an earlier session · ask {name} to update it" |
| Replaced card header (unchanged) | "Updated cart below" / "Updated plan below" |
| Phone tab | "Search" |
| `/plans`, `/plans/…` | Existing shell not-found: "This page doesn't exist." · "Back to chat" |
| Step label for `plan set`/`patch` | "Updated the event" / "Updating the event" |
| `shop refresh` on no cart (tool error, model-facing) | "There is no cart to refresh." |

`{name}` is the persona name (`persona.name`), as used elsewhere in the chat.

## Agent prompt and tools

- `tools/plan.ts` `DESCRIPTION` becomes: `'This chat's plans for the current session: events/parties, trips and shortlists (plus the shopping cart, read-only here). Record every trip, event or shortlist you plan with action "set" (kind event: {…}; trip: {…}; shortlist: {…}). The workspace note at the top of each turn lists the current plans; they last for this conversation only and aren't saved anywhere else. For follow-ups that change a detail ("make it 16 kids", "move it to the 20th") use action "patch" with ops like […] …, then call shop with only the items whose quantities changed. Never rebuild the plan or re-search unchanged items. "get" reads an entity back. set and patch show a plan card.'` (the field lists and patch example unchanged).
- `tools/plan.ts` result verbs: "Saved" → "Set", "Updated" stays. "No {kind} "{id}" is saved in this chat." → "No {kind} "{id}" in this chat." "No {kind} is saved yet; use set first." → "No {kind} "{id}" yet; use set first."
- `tools/shop.ts` description: add one sentence after "Pass stores only to switch stores…": "refresh: true re-checks every item's price at the cart's stores." Add `refresh` to the parameters.
- The workspace note: see "Prices are stale, and the model is told". It replaces "Saved plan state for this chat…".
- `prompt/systemPrompt.ts`: no change. It never claims plans are saved or visible in a Plans section; the session-only rule lives in the workspace note so the cached system prompt stays stable.
- Skills (`party-planning`, `trip-planning`, `grocery-run`): no change. They say "record the plan with plan set", which stays true.

## Edge cases

| Case | Behaviour |
|---|---|
| The user emptied the cart, then the session restarts | The marker after the last card → no cart; note lists the previous items. "Add milk" starts a new cart (the model must pass stores). |
| `new_cart` that found nothing | Marker → no cart restored; note. |
| Two `shop` calls in one turn | Two cards (dedupe removed for carts); the newest is restored. |
| A `shop` call fails after `remove` mutated the cart | Marker → no cart restored. Conservative by design. |
| The reply holding the newest card failed to save (`not_saved` banner shown) | The rebuild restores the previous card. The user saw "This reply wasn't saved", so the transcript and the chat already disagree. Known limitation; not worth a second write path. |
| The newest card is older than the 200-row window | Not restored, no note (the agent knows nothing about it). The user re-asks. |
| Parts over 500,000 characters | Cards dropped plus marker → nothing restored for that chat; notes say so. |
| A legacy card (before `storeIds`) | Not restored; the note offers the item list. |
| Plan card with an entity the current schema rejects | Lost; note. Older cards of that `(entity, id)` are not used. |
| Edits on a user row whose cart was later replaced by a newer card | Applied to the old card during the walk, then overwritten by the newer card (which already includes them, because the session applied them before that turn). |
| Event edit when the transcript has two events | Applied to the most recently touched one, the same rule as in the live session. |
| Persona change mid-run (`retireUser` marks the busy entry retired) | The run finishes on the old session; the next run creates a new session and rebuilds. |
| Pending, unsent edits on a live card, then reload | Lost (they lived only in `CartCard` state). After the reload the card is locked; the user asks to refresh or re-states the change. |
| A history cart with a `javascript:` pick URL | Rendered as text (`ExternalLink`). |
| `/api/plans` or the agent's `/plans` called directly | 404 (no route). The agent path also loses `requireUser`, so it 404s for every caller, signed in or not. |
| Signed out, `/login?next=/plans` | `safeNext` → `/`. |
| Existing rows in `workspace_entities` | Never read; not shown. |

## Database

- No migration in this change. `workspace_entities`, `workspace_put`, `workspace_counts` and their indexes stay.
- No runtime path reads or writes them (`grep -rn "workspace_entities\|workspace_put\|workspace_counts" agent/src web shared` matches only `agent/src/db/database.types.ts`).
- `database.types.ts` stays unchanged and in step with the live schema: it is generated output, and regenerating now would produce the same file.
- `rls.int.test.ts` keeps its checks that the table and both functions are closed to `anon`/`authenticated` and that `workspace_counts` is invoker-rights with an empty `search_path`. These check objects that still exist and could still be exposed by mistake.
- Supabase advisors: none expected to change (no DDL). Run `get_advisors` (security and performance) after deploy and record the result in the Build notes.

### Follow-up migration (written, not applied)

Applied only after the owner explicitly confirms the drop, in its own PR and migration file `supabase/migrations/<version>_drop_workspace_entities.sql`. Until then this SQL lives only in this spec:

```sql
drop function if exists public.workspace_counts(uuid);
drop function if exists public.workspace_put(uuid, uuid, text, text, jsonb, integer);
drop index if exists public.workspace_entities_user_recent_idx;
drop index if exists public.workspace_entities_chat_user_idx;
drop table if exists public.workspace_entities;
```

`workspace_entities_pkey` goes with the table, as do its two foreign keys (`user_id → auth.users`, `(chat_id, user_id) → chats`). The table has no policies and no triggers (verified live). No backup step: the rows are operational state the owner has declared disposable (6 rows, 1 user at the time of writing).

That PR also:

- regenerates `agent/src/db/database.types.ts` (the `workspace_entities` table and both functions disappear);
- removes `workspace_entities` from the table list and the `workspace_put`/`workspace_counts` checks and index names in `agent/test/supabase/rls.int.test.ts`;
- runs `get_advisors` and records the result;
- leaves the historical migrations (`20261101060645_chats_workspace.sql`, `20261101214044_app_shell_search.sql`, `20261101225832_workspace_counts.sql`) untouched.

## Search

Nothing to remove: search covers chats (titles and message `content`) and reports (titles). Plans were never in it, and `scope=plans` already returns 400. Checks for the build:

- The scope tabs read All · Chats · Reports with counts (unchanged).
- The `SearchView` empty and help copy doesn't mention plans (verified: no "plan" string in `web/components/search/`).
- The new user-row `parts` don't affect search, because `search_user_content` matches `content`, not `parts`.

## Architecture explainer notes

Replacement text for the explainer page, for the owner to apply separately:

- **Sections.** The shell has three sections: Chats, Search and Reports. Plans was removed on 2026-11-02.
- **Working state.** Carts, trips, events and shortlists live in the agent's session for the chat (`ActiveCart` and an in-memory workspace store). They are not saved anywhere else. The transcript (`chat_messages.parts`) keeps every card the user saw, plus two agent-only markers: the UI edits sent with a message, and a note when a cart changed without a card.
- **Restart.** When a session is recreated, the newest cart card and the newest card per plan are read back from the transcript, the saved edits are replayed, and the model is told the prices are from that card's date.
- **Cards.** Only the newest card that arrived in the open pane can be edited. Cards from history are read-only and dated, and the newest cart has a "Refresh prices" chip.
- **Database.** `workspace_entities` is unused and kept until the owner confirms the drop.
- **Reports** are unchanged: `artifacts` table, Storage, the Reports section and the report panel.

## Testing

### Web unit and component tests (vitest, Testing Library)

- `test/chat/history.test.ts`: `cardDates` maps only cart and plan `show_widget` parts to their row's `createdAt`. `toHistory` skips `workspace_edits` and `working_state` parts.
- `test/widgets/cart.test.tsx`:
  - live (`onEdit` set) shows dec, inc, swap and remove;
  - earlier-locked (`lockedAt` ISO) renders `×2` text, no `-dec`/`-inc`/`-swap`/`-remove`/`-alts`/`-restore-`, the note "Prices from Nov 1 · ask Sage to refresh", store tabs still switch;
  - `lockedAt: null` → "Prices may be out of date · ask Sage to refresh";
  - `onRefresh` renders `-refresh` "Refresh prices" and calls it; no `onRefresh` → no chip;
  - replaced (`stale`) still says "Updated cart below" and now also renders no stepper buttons;
  - a `javascript:` pick URL and hand-off URL render as text when locked.
- `test/widgets/plan.test.tsx`: earlier-locked plan shows "From Nov 1 · ask Sage to update it", no inputs or stepper buttons; step labels "Updated the event" / "Updating the event".
- `test/lib/dates.test.ts` (or the existing dates test): `cardDate` same day / same year / other year / invalid.
- `test/chat/components.test.tsx` (ChatSession with CopilotKit mocked, as in `chatHost.test.tsx`):
  - history containing a cart card → locked with the history date, Refresh chip shown; clicking it adds a visible user message "Refresh my cart's prices" and starts a run;
  - a `show_widget` cart streamed by a run → live (controls present), the history cart has no chip anymore (it's no longer newest);
  - a second streamed cart → the first is replaced ("Updated cart below"), the second live;
  - unmount and remount with the agent's cached messages → the formerly live card is locked with "Prices may be out of date";
  - while running, no Refresh chip;
  - plan cards: history plan locked; streamed plan for the same `entity:id` live; a different `id` keeps its own lock state.
- `test/shell/*`: Rail has no `rail-plans`; `MobileTabs` renders Chat, Search, Reports, You, and `mobile-tabs-search` gets `aria-current="page"` on `/search`; `MobileTopBar` has no Plans title; navigating to `/plans` renders `shell-not-found-title`.
- `test/auth/safeNext.test.ts` and `test/api/routes.test.ts`: as in the removal list.
- `test/widgets/widgets.test.tsx`: a cart widget with `storeIds` validates and renders.

### Agent tests (vitest)

- `test/workspace/rebuild.test.ts` (new), for `rebuildWorkingState`:
  - newest valid cart card wins over an older one;
  - edits on a later user row are replayed (qty, remove, pick swap) and edits before the card are ignored;
  - `working_state {cart:"unshown"}` after the card → no cart, note listing the items;
  - a malformed newest cart card → no cart, "couldn't be read" note, and the older valid card is **not** used;
  - a legacy card (no `storeIds`) → no cart, note with items;
  - plans: newest per `(entity, id)`, two trips with different ids both restored in touch order, event edits applied to the most recently touched event, an invalid plan card marks only its own key lost, `{plans:"unshown"}` drops all;
  - interrupted rows count; rows without parts are skipped; `shownAt` is the row's `createdAt`;
  - unparsable `workspace_edits` args are ignored (and logged).
- `test/render/cart.test.ts`: `renderData` copies `storeIds`; `cartFromWidget` round-trips through `ActiveCart.view()` and `renderData` to the same stores, items, picks and totals; returns `null` without `storeIds`.
- `test/agui/transcript.test.ts`: a `shop` call followed by its `-widget` → no marker; `shop` without a widget → `working_state` marker at its position; an aborted `shop` (start, no result) → marker; the 500,000-character fallback appends the both-unshown marker; `parts()` returns parts when only a marker exists.
- `test/agui/translate.test.ts`: two `shop` results in one run emit two cart widgets; two weather results still emit one.
- `test/agui/workspace.test.ts` (rewritten):
  - edits from the AG-UI context are written as a `workspace_edits` part on the user row, and applied to `entry.cart` / `entry.workspace` before the turn;
  - a new session for an existing chat is created with a seed containing the stored rows; the restored cart is on `entry.cart` with `restoredFrom`, and the note contains "(from a card shown …)" and the refresh guidance;
  - an existing session gets no seed;
  - after `retireUser`, the next run rebuilds;
  - no `RunContext.workspace` anywhere (type-level: the field is gone).
- `test/workspace/followup.test.ts`: "make it 16 kids" patches the event and changes only quantities with no new catalog search (on the memory store); the summary reflects the patched event; "reloads the cart from the workspace into a new session" becomes "rebuilds the cart from the transcript into a new session"; "persists UI edits" becomes "replays saved UI edits onto the rebuilt cart".
- `test/workspace/store.test.ts`: `seed` keeps versions and order; `put` clears `restoredFrom` unless `keepRestored`; the summary suffix.
- `test/tools/shop.test.ts` (or the existing shop unit test file): `refresh` searches every cart item and clears `restoredFrom`; `refresh` on an empty cart fails with "There is no cart to refresh."; `data.storeIds` equals `cart.stores`.
- `test/tools/plan.test.ts`: new description and verbs; for each plan kind, a valid entity's `set` always yields a valid `plan` widget.
- `test/http/chats.test.ts`: `/chats/:id/messages` strips `parts` from user rows and agent-only parts from assistant rows, and omits `parts` when nothing is left.
- `test/app.test.ts`: `GET /plans` and `GET /plans/<uuid>/trip/dDE` → 404 for a signed-in user.
- `test/session/createSession.test.ts`: the factory builds a memory store and never touches `repos.workspace` (the repo type no longer has it; the test asserts the seeded state).
- A static check in `test/db/imports.test.ts` (it already guards imports): no file under `agent/src` except `db/database.types.ts` contains `workspace_entities`, `workspace_put` or `workspace_counts`.

### Integration against Supabase (`npm run test:supabase`)

- `repos.int.test.ts`: `messages.append` with a user row that has `parts` round-trips through `messages.history`. The workspace cases are removed.
- `rls.int.test.ts`: unchanged.

### End-to-end (`e2e/app-shell.demo.spec.ts`)

Seed (`e2e/support/seed.ts`), replacing the entity rows:

- On `chats[2]` (the cart chat): an assistant row whose `parts` hold one `show_widget` cart card (Trader Joe's, the same three items, with `storeIds: ["traderjoes"]`) and a short text part, `created_at` = `ago(0, 3)`.
- On the Big Sur chat: a trip `plan` card part on the existing reply, after the two report parts.
- Export `CART_CARD_ID` and `TRIP_CARD_ID` (the part ids) so the steps can build element ids.

Steps:

- **New step 7, "Cards from earlier sessions are read-only".** Open the cart chat. `#chat-pane-<chat>-cart-<CART_CARD_ID>-locked-note` contains "Prices from" and "ask Sage to refresh"; no element matching `[id$='-dec'], [id$='-inc'], [id$='-swap'], [id$='-remove']` inside the card; `#…-refresh` is visible. Reload the page and repeat the same checks (still locked after a reload). Open the Big Sur chat: the trip card shows "From … · ask Sage to update it" and has no `input:enabled`. Step 3's live run in the Big Sur chat must not unlock it (assert after step 3's run has finished).
- **Step 8:** replace the plan deep links with `extra.goto("/plans")` → `#shell-not-found-title` "This page doesn't exist." with `#rail` visible, and `extra.goto("/plans/<chat>/trip/dDE")` → the same. Signed out, `/login?next=%2Fplans` → after sign-in lands on `/`.
- **Step 9:** axe paths become `/`, `/search?q=big`, `/reports`, and the cart chat (`/chats/<cart chat>`), so the locked card and chip are contrast-checked in light and dark.
- **Step 10:** the rail's keyboard order no longer includes `#rail-plans`.
- **Step 13 (phone):** tabs `#mobile-tabs-search` (`/search$`), `#mobile-tabs-reports`, `#mobile-tabs-chat`, each with `aria-current="page"` and no horizontal scroll at 390 px. The cart chat's locked card fits 390 px without horizontal scroll.
- The live Refresh click is not in the E2E run: it depends on live store sites. The component test covers the message it sends; the agent test covers `shop refresh`.

### Before each commit

`npm run build` in `web/`, the agent's `tsc --noEmit`, `npm test` in `agent/` and `web/`, `npm run test:supabase`, then a self-review of the diff. Rebuild and restart the Docker stack after the agent and web changes land, and run the E2E demo.

## Build order and commits

1. `feat(shared): agent-only transcript part names and cart store ids`: `shared/chats.ts`, `CartSchema.storeIds`, the `shop` data and registry change, tests.
2. `feat(agent): keep plans in the session and rebuild them from the transcript`: memory store on the session entry, `rebuild.ts`, `cartFromWidget`, edits on the user row, transcript markers, cart dedupe removed, `shop refresh`, workspace note, plan tool copy, `/chats/:id/messages` stripping, tests.
3. `refactor(agent): remove the plans endpoints and the workspace repo`: `http/plans.ts`, `plans/view.ts`, `cartWidget`, `WorkspaceRepo`, `server.ts` wiring, tests and fixtures.
4. `feat(web): lock cards from earlier sessions and date them`: `arrived`/`shownAt`, `CartCard`/`PlanCard` locked rendering, Refresh chip, `cardDates`, `cardDate`, step labels, tests.
5. `refactor(web): remove the Plans section`: routes, API routes, components, `lib/plans.ts`, rail, phone tabs (Search tab), top bar, `useRoute`, `shared/routes.ts`, `shared/lists.ts`, `entityKey`, tests.
6. `test(e2e): locked cards, reloads and the removed Plans section`: seed and steps.
7. `docs: README and CONTRIBUTING without Plans`, plus Build notes in this spec.

Each commit builds and passes its tests on its own.

## Rollout

- Users have saved plans now (live: 6 rows, 1 user). After deploy, the Plans section, its rail icon and its phone tab are gone, and those rows are never read again. Nothing is migrated: a saved cart's prices are already stale, and the owner's rule is to re-ask.
- Chats keep their cards. Old cart cards have no `storeIds`, so the first message in such a chat after deploy gets the legacy note and the model offers to start the cart again with the same items. Old plan cards are fully restorable.
- Live agent sessions at deploy time are discarded by the container restart, so every chat's first post-deploy run takes the rebuild path. No session mixes old and new state.
- Bookmarks to `/plans` show the shell's not-found page.
- No feature flags: the change ships whole.
- The drop of `workspace_entities` waits for the owner's explicit confirmation (see "Follow-up migration").

## Builder's calls in this spec (summary)

- Not-found, not a redirect, for removed routes.
- Search becomes the phone tab that replaces Plans.
- Agent-only `workspace_edits` and `working_state` parts in the transcript, stripped at the API.
- `storeIds` on cart cards; legacy cards are not rebuilt.
- Cart cards are exempt from the one-card-per-kind-per-run rule.
- Conservative markers: any `shop` call without a card cancels the cart rebuild.
- Live means "arrived in this mounted pane and newest"; remounts lock.
- A Refresh prices chip on the newest locked cart only; plans get the dated line only.
- `shop refresh` added, because there is no other way to re-price items already in the cart.
- Locked cards render no controls at all (not disabled ones), for both replaced and earlier cards.
- `database.types.ts` and the RLS checks for the table stay until the drop.

## Open questions for the owner

None. The one decision reserved for the owner, confirming the drop of `workspace_entities`, is already part of the brief and is handled by "Follow-up migration".
