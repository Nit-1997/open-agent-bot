# Ephemeral plans

Status: reviewed, ready to build · 2026-11-02 · branch `feat/supabase-auth`

Review basis: the owner's brief for this change; the app shell spec (`2026-11-01-app-shell-and-agent-persona-design.md`) and the report side panel spec (`2026-11-01-report-side-panel-design.md`), both with their Build notes; the supabase auth spec (`2026-10-31-supabase-auth-design.md`); the source at `efaf060`; `@copilotkit/core` and `@copilotkit/react-core` 1.83.0 in `web/node_modules`; and the live Supabase project `dwiuzfvmevdzzabqeaog`, read only (row counts, indexes, constraints, functions, policies, triggers and dependants of `workspace_entities`). Decisions marked **builder's call** were made where the brief left room. Everything else comes from the owner's brief. See "Review changes" at the end for what the review cut and why.

## Decision record

The owner decided that carts, trips, events, shortlists and other plan widgets are working state for one conversation. In the owner's words:

- "Only thing is we just need to structurally hold the chat together. When someone comes, they can re-query it. That's as simple as that."
- "A cart from yesterday, what will I do with it today? The prices would have changed… the agent will just basically take that as a new message and again build a cart."

There is no checkout, and memory is for preferences, not operational state.

So:

- Carts and plans live in the live agent session only.
- Cards saved in the chat transcript (`chat_messages.parts`, which already holds every card the user saw) are **display-only**. A card loaded from history is locked and dated.
- Re-asking is how the user gets a fresh cart. When a session is recreated, the agent does **not** rebuild a live cart or plan. It gets a short read-only note describing the chat's most recent cart and plan cards, with their dates, and is told the prices may be stale.

Reports are different. They are finished documents and stay exactly as they are: the `artifacts` table, Storage, the Reports section and the report panel.

The Plans section goes away, and the agent stops writing plan entities to the database.

## Goals

- No Plans section anywhere: rail, phone tabs, routes, web API, agent endpoints, route parsing, tests, types and docs.
- The agent never reads or writes `workspace_entities` at runtime. The table and its two functions stay in the database untouched until the owner confirms the drop.
- In-session behaviour is unchanged. On the latest live card the user can change quantities, swap picks and remove items, and change guests, dates and budget on the latest event or trip. The agent's `shop` and `plan` follow-ups ("make it 16 kids", "add tortillas") keep working for the life of the session.
- Cards loaded from history are locked and dated: "Prices from {date} · ask {name} to refresh".
- When the session is recreated, the model gets a read-only note about the chat's last cart and plan cards and their dates. Edits that reach a session which no longer holds the card are shown to the model, never dropped silently.

## Non-goals

- Rebuilding a live cart or plan from the transcript after a session is recreated (see "Review changes" for why).
- Dropping `workspace_entities`, `workspace_put` or `workspace_counts`. The SQL is written here and is applied only after the owner confirms (see "Follow-up migration").
- Migrating existing saved plans into transcripts. They stop being shown (see "Rollout").
- Cross-chat plans, a list of past carts, or search over plan contents.
- Any change to reports, the report panel, `artifacts` or Storage.
- Changing the per-run widget dedupe (`renderedKinds`) or adding a price-refresh mode to `shop`.
- Rewriting the downloadable architecture explainer page in `~/Downloads`. The owner handles that separately; "Architecture explainer notes" below gives the replacement text.

## Anti-goals (failures even if it works)

- A card loaded from history shows enabled quantity, swap or remove controls.
- After a session is recreated, the model quotes an old card's total as current, or acts as if an old cart is still live.
- The user edits a card and the edit vanishes without the model hearing about it.
- Any runtime code path calls `workspace_entities`, `workspace_put` or `workspace_counts`.

## Verified facts

| Fact | Where |
|---|---|
| Live: `workspace_entities` holds 6 rows for 1 user. RLS is enabled (not forced) with **no policies**, so `anon`/`authenticated` are denied. No triggers, no views or publications reference it, and no other function's body mentions it. Indexes: `workspace_entities_pkey (chat_id, kind, entity_id)`, `workspace_entities_chat_user_idx (chat_id, user_id)`, `workspace_entities_user_recent_idx (user_id, updated_at desc, chat_id, kind, entity_id)`. Constraints: the primary key, FKs `user_id → auth.users(id)` and `(chat_id, user_id) → chats(id, user_id)`, both `on delete cascade`, and checks on `kind`, `entity_id` length, `version > 0` and `value` size. Functions: `workspace_put(uuid, uuid, text, text, jsonb, integer) returns integer` and `workspace_counts(uuid) returns jsonb`, both invoker-rights with `search_path=""`. | Supabase, read-only queries |
| The session store drops a session after **30 minutes idle** (`SESSION_IDLE_MS`), checked every 60 seconds. It also drops the least recently used idle session when a user opens a fourth (`perUser: 3`), and `retireUser` drops a user's sessions on a persona change. | `agent/src/server.ts`, `agent/src/session/sessionStore.ts` |
| A pane stays mounted while its chat is active or running, so a tab left open on a chat for more than 30 minutes keeps showing cards whose session is gone. The next run creates a new session. | `web/lib/shell/chatController.ts` `mountedIds`, `sessionStore.ts` `sweep` |
| Today the cart survives a new session only because `sessionFactory` loads it from `workspace_entities` (`workspaceCart(SupabaseWorkspaceStore)`). With an in-memory store, a new session starts with an empty `ActiveCart`, and `applyEdits` on an empty cart changes nothing and reports nothing. | `agent/src/session/createSession.ts`, `agent/src/workspace/cart.ts`, `agent/src/shop/cart.ts` |
| `RunContext.workspace` is a **second** `SupabaseWorkspaceStore` built per run in `server.ts` (and in `test/fixtures/app.ts`), separate from the one `sessionFactory` builds. `runTurn` applies event/trip edits and reads the evidence summary through it. Today the two agree only because both hit the database; with memory stores they would split. | `agent/src/server.ts` `runContext`, `agent/src/agui/runHandler.ts` `runTurn` |
| UI edits travel as the AG-UI context item `workspace_edits` with the next user message. `runTurn` applies cart edits to `entry.cart` and, through `applyEntityEdits`, event/trip edits to the latest entity of that kind. No card is emitted for them. | `runHandler.ts`, `workspace/edits.ts`, `web/components/chat/ChatSession.tsx` |
| Every widget the user sees is a synthetic `show_widget` tool call with id `<toolCallId>-widget` and args `{"widget": …}`. The transcript saves `show_widget` args verbatim. | `agent/src/agui/translate.ts`, `agent/src/agui/transcript.ts` |
| A cart card has per-store `name`, `total`, `currency`, `url`, `missing` and `items[{query, qty, picks≤3}]`. A plan card is `{kind:"plan", entity, id, version, value}` with `value` checked by the entity schema. | `shared/widgets.ts` `CartSchema`, `PlanSchema` |
| On a new session, `handleRun` loads the last 200 rows (`messages.history`, with `parts`) and passes **text-only** history to `getOrCreate`. The new session's model never sees card contents. The current run's user row is written after the session is created. | `runHandler.ts` `seedHistory`, `persist`; `agui/input.ts` `historyFromStored` |
| CopilotKit 1.83: `useAgent({ agentId, runtimeAgentId, threadId })` registers a **new** `ProxiedCopilotRuntimeAgent` on mount and unregisters it on unmount (`registerProxiedAgent`); the provisional agent cache is a per-hook `useRef`. Nothing keeps an agent's messages across a pane remount. A remounted pane gets its messages only from `props.history` (`ChatSession` calls `setMessages(history)` when the agent is empty). | `web/node_modules/@copilotkit/react-core/dist/copilotkit-*.mjs` `useAgent`, `@copilotkit/core/dist/index.mjs` `registerProxiedAgent` |
| `CartCard` and `PlanCard` already have a `locked = stale \|\| !onEdit` state. Locked `CartCard` hides swap, alternatives and remove, and disables the stepper. Locked `PlanCard` disables its inputs. `WidgetRenderer` passes `onEdit` only when the card is not stale. | `web/components/widgets/CartCard.tsx`, `PlanCard.tsx`, `WidgetRenderer.tsx` |
| Unknown shell paths render the shell's not-found page (`app/(app)/[...missing]/page.tsx` → `notFound()` → "This page doesn't exist."). Once the `plans` folders are deleted, `/plans…` falls through to it. `safeNext` maps any path `parseRoute` rejects to `/`. | `web/app/(app)/`, `web/lib/auth.ts` |
| The search page has its own search field (`SidebarSearch` in `SearchView`) and its own hint, so it works as a phone tab. Search scopes are `all`, `chats` and `reports`; `scope=plans` is already a 400 (web route) and `22023` (RPC). | `web/components/search/SearchView.tsx`, `shared/lists.ts`, `agent/test/supabase/search.int.test.ts` |
| The `lists` rate-limit bucket is shared with reports and chats, so it stays. No limiter key is Plans-only. | `agent/src/lib/rateLimit.ts`, `agent/src/http/plans.ts` |

## Decisions at a glance

| Topic | Decision |
|---|---|
| Removed routes | **Not found**, not a redirect. `/plans` and `/plans/…` fall through to the existing shell not-found page. Signed-out `?next=/plans` lands on `/` because `parseRoute` rejects it. Why: the feature is gone, not moved. The section existed for about a day with one real user, and the not-found page already offers "Back to chat". |
| Phone tabs | Chat · Search · Reports · You (still 4 columns). Search replaces Plans, so the tabs match the rail (Chats, Search, Reports). It stays in the drawer too. |
| Where plan state lives | `SessionEntry.workspace` (a `MemoryWorkspaceStore`) and `SessionEntry.cart` (`ActiveCart`), both created by `sessionFactory`. `RunContext.workspace` is removed. |
| New session | No rebuild. The model gets a read-only `<earlier_cards>` note built from the newest cart card and the newest plan cards in the loaded transcript, each with its date. |
| Edits that can't apply | If a run brings cart edits and the session's cart is empty, or event/trip edits and the session holds no entity of that kind, the model gets a one-turn note listing them. |
| Live vs locked | A card is live only if it arrived by a run streamed into **this mounted pane** and is the newest of its kind (cart) or of its `entity:id` (plan). Everything from history is locked, reusing the cards' existing `locked` state. |
| Refresh | No chip and no new `shop` mode. The dated line tells the user to ask. `shop`'s description gains one sentence on re-pricing with `new_cart`. |
| `database.types.ts` | Unchanged. It is generated from the live schema, where the table and functions still exist. The follow-up migration's PR regenerates it. |
| RLS integration checks on the table | Kept until the drop. They assert the security posture of objects that still exist. |
| Follow-up migration | SQL is in this spec only. The builder must not add it to `supabase/migrations/` (where `db push` would apply it). |

## Removal list

### Web

Delete:

- `web/app/(app)/plans/page.tsx`
- `web/app/(app)/plans/[chatId]/[kind]/[key]/page.tsx` (and the now-empty `web/app/(app)/plans/` tree)
- `web/app/api/plans/route.ts`
- `web/app/api/plans/[chatId]/[kind]/[key]/route.ts` (and the now-empty `web/app/api/plans/` tree)
- `web/components/plans/` (`PlansView.tsx`, `PlanKindFilter.tsx`, `PlanRow.tsx`, `PlanDetail.tsx`)
- `web/lib/plans.ts`

Change:

- `web/components/shell/Rail.tsx`: remove the `rail-plans` `RailLink` and the `SquareCheckBig` import.
- `web/components/shell/MobileTabs.tsx`: replace `mobile-tabs-plans` with `<Tab id="mobile-tabs-search" href="/search" label="Search" icon={Search} active={section === "search"} />`, placed between Chat and Reports. Swap the `SquareCheckBig` import for `Search`. The grid stays `grid-cols-4`.
- `web/components/shell/MobileTopBar.tsx`: remove the `plans` and `plan` entries from `TITLES` (the `Route` type no longer has them, so `tsc` requires it).
- `web/lib/shell/useRoute.ts`: `NavSection` becomes `"chat" | "search" | "reports"`. Remove the `plans`/`plan` cases.
- `ShellOverlays.tsx`, `AccountSheet.tsx`, `MobileDrawer.tsx`: no change (verified: no Plans item).
- `web/components/chat/ChatSession.tsx`, `TurnView.tsx`, `web/components/widgets/WidgetRenderer.tsx`, `CartCard.tsx`, `PlanCard.tsx`, `web/lib/chats.ts`, `web/lib/shell/chatController.ts` (the `Thread` type and `loaded` action), `web/components/chat/ChatPane.tsx`: see "Live versus locked" and "Card UI".
- `web/lib/steps.ts` `planLabel`: "Saved/Saving the event" becomes "Updated/Updating the event" (set and patch). "Read/Reading" stays for `get`.
- `web/test/shell/sections.test.tsx`: delete the `PlansView and PlanDetail` block and its imports and fixtures.
- `web/test/api/routes.test.ts`: delete the two plans imports, the `plans page` and `plans kind` 400 cases and the two forwarding asserts. Keep `search scope … scope=plans → 400`.
- `web/test/auth/safeNext.test.ts`: remove the `/plans…` round-trip cases. Turn the two `/plans/…/trip/%%%` and `/!!` cases into `safeNext("/plans", ORIGIN)` → `/` and `safeNext("/plans/<uuid>/trip/dDE", ORIGIN)` → `/`.
- `web/test/shell/focus.test.tsx`: replace `go("/plans")` with `go("/reports")` (it only needs a non-search section).
- `web/test/widgets/plan.test.tsx`: update the step-label expectations to "Updated the event" and "Updating the event".

### Shared

- `shared/routes.ts`: remove the `plans` and `plan` `Route` variants, their `parseRoute` cases (so `/plans…` → `null`), their `hrefFor` cases, and the `EntityKind`, `entityIdFromKey` and `isEntityKind` imports.
- `shared/lists.ts`: remove `PLANS_PAGE_SIZE`, `PlanSummary`, `PlanCounts`, `PlansResponse` and the `EntityKind` import.
- `shared/workspace.ts`: remove `entityKey`, `entityIdFromKey`, `B64URL`, `KEY_RE` and `ENTITY_ID_MAX` (only `entityIdFromKey` uses it). Keep the entity schemas, `ENTITY_KINDS`, `isEntityKind` (the plan tool uses it), `PLAN_KINDS`, `isPlanKind`, `validateEntity`, `applyPatch`, the edit schemas, `parseWorkspaceEdits` and `safeHttpUrl`.
- `shared/widgets.ts`: no change.

### Agent

Delete:

- `agent/src/http/plans.ts`
- `agent/src/plans/view.ts` (the `agent/src/plans/` directory)
- `agent/test/http/plans.test.ts`, `agent/test/plans/view.test.ts`, `agent/test/fixtures/plans.ts`

Change:

- `agent/src/app.ts`: remove the `planRoutes` import and mount, and `"/plans"`, `"/plans/*"` from `USER_PATHS`. The `lists` rate limit stays.
- `agent/src/server.ts`: `runContext` no longer builds a `SupabaseWorkspaceStore`. Remove the import.
- `agent/src/db/types.ts`: remove `WorkspaceRepo`, `ChatEntity`, `EntityCounts` and the `workspace` field of `UserRepos`. `VersionedEntity` moves to `agent/src/workspace/store.ts` (its only users are the store, the plan tool and edits), and the `EntityKind` import goes with it.
- `agent/src/db/users.ts`: remove `EntityRow`, `toEntity`, `CountsSchema`, `workspace()`, the `workspace:` entry in `forUser`, and the imports that only they use (`PLANS_PAGE_SIZE`, `ENTITY_KINDS`, `VersionConflict`, `WorkspaceRepo`, `ChatEntity`, and `Value`/`pageOffset` if nothing else uses them; the builder confirms with `tsc`).
- `agent/src/render/cart.ts`: remove `cartWidget` (only `plans/view.ts` uses it).
- `agent/src/workspace/store.ts`: remove `SupabaseWorkspaceStore`. `MemoryWorkspaceStore` becomes the only implementation, unchanged.
- `agent/src/session/sessionStore.ts`, `agent/src/session/createSession.ts`, `agent/src/agui/runHandler.ts`, `agent/src/workspace/cart.ts`, `agent/src/tools/plan.ts`, `agent/src/tools/shop.ts`: see "Session state" and "Agent prompt and tools".
- New `agent/src/workspace/earlier.ts`.
- `agent/src/db/database.types.ts`: **no change** (see "Database").

Tests to change:

- `agent/test/fixtures/app.ts`: its `runContext` drops `workspace: new SupabaseWorkspaceStore(…)` and the import.
- `agent/test/fixtures/memoryRepos.ts`: remove the `workspace` repo, the `PLANS_PAGE_SIZE`, `ENTITY_KINDS`, `EntityKind`, `EntityCounts` and `VersionConflict` imports, and the entity rows.
- `agent/test/db/repos.test.ts`: delete "maps PT409 from workspace_put…" and "counts plans per kind…".
- `agent/test/db/imports.test.ts`: remove `workspace_entities` from the allowed `.from(…)` table list, and add the static check in "Testing".
- `agent/test/supabase/repos.int.test.ts`: delete the workspace half of "claims chats for their owner only and keeps workspace versions in step" (keep the claim checks), and the `workspace.page`/`workspace.counts` lines of "reads one chat, chat titles, reports with their chats and plans across chats" (renamed "…reports with their chats").
- `agent/test/workspace/store.test.ts`: delete the Supabase parameterisation, "never writes into another user's chat" and "keeps the database's kind check in step with ENTITY_KINDS". Keep the memory-store cases.
- `agent/test/shared/routes.test.ts`: remove the `/plans…` round trips, the `/plans?kind=boat` normalisation, the plan-key cases and the `entityKey` import. Add `parseRoute("/plans")` and `parseRoute("/plans/<uuid>/trip/dDE")` → `null`. Keep the `scope=plans` search normalisation case.
- `agent/test/shared/lists.test.ts`: delete the `entityKey` block. Keep the `safeHttpUrl` cases.
- `agent/test/agui/workspace.test.ts` and `agent/test/workspace/followup.test.ts`: rewritten against the session-held store (see "Testing").
- `agent/test/http/search.test.ts`, `agent/test/supabase/search.int.test.ts`: unchanged (their `scope=plans` cases check that it is rejected).
- `agent/test/skills/skills.test.ts`: unchanged (skills still say "plan set").
- `agent/test/supabase/rls.int.test.ts`: **kept** as is (see "Database").

### E2E

- `e2e/app-shell.demo.spec.ts`: remove the local `entityKey` and the `TRIP_ID` import, step 7, the plan-detail deep link in step 8 (keep the `/plans/<chat>/trip/..` not-found check, changed to `/plans`), `/plans` from the axe paths in step 9, and `#mobile-tabs-plans` in step 13. Rename the test title to drop "plans". Add the steps in "Testing → E2E".
- `e2e/support/seed.ts`: remove `SEED.plans`, `TRIP_ID`, the `entities` array and the `workspace_entities` insert, and `tripChat` from `Seeded` (it is always `bigSur`). Add the transcript cards in "Testing → E2E". `supabase/scripts/cleanup-e2e.mjs` needs no change (it never names the table; rows cascade from chats).

### Docs

- `README.md` line 83 ("Workspace and chats"): replace the first sentence with "Chats and their messages are saved in Supabase, and a chat continues after an agent restart. Carts, trips, events and shortlists are working state for the conversation: they live in the agent's session only. Cards from earlier sessions stay in the chat, read-only and dated; ask again for fresh prices." Remove the **Plans** view from the list of sections.
- `README.md` line 90 (E2E): "seeds chats, reports and plans" → "seeds chats, reports and saved cards".
- `CONTRIBUTING.md` lines 86–93: remove `/plans` and `/plans/[chatId]/[kind]/[key]` from the routes list and `components/plans/` from the section views.

## Session state

`SessionEntry` gains `workspace: WorkspaceStore` (required) next to the existing `cart?: ActiveCart`. `RunContext.workspace` is removed. `runTurn` applies edits to `entry.workspace` and `entry.cart`, and adds `await entry.workspace.summary()` to evidence. Both stores live and die with the session, so the plan tool, the UI edits and the evidence summary all see the same state. This is the minimal fix for the split described in "Verified facts": without it, the per-run store and the session's store would be two different memory stores.

`sessionFactory` builds `new MemoryWorkspaceStore()` instead of `new SupabaseWorkspaceStore(repos.workspace, chatId)`, and returns `workspace` on the entry. `workspaceCart(store)` is unchanged: on a new store it finds no saved cart, so the `ActiveCart` starts empty, and its `onSave` keeps mirroring the cart into the memory store so `plan get kind:cart` and the summary keep working.

`MemoryWorkspaceStore` and `ActiveCart` need no new fields.

### Earlier cards (new session only)

`earlierCards(rows: StoredMessage[]): EarlierCards`, a pure function in `agent/src/workspace/earlier.ts`, walks the loaded rows (the same last-200 window `messages.history` returns) and each row's `parts` in order, and keeps:

- `cart`: the newest `show_widget` part whose widget is a valid `cart` (`validateWidget`), with the row's `createdAt`;
- `plans`: the newest valid `plan` card per `entity:id`, newest first, at most 3, each with its row's `createdAt`.

Unparsable or invalid cards are skipped. This note is a hint, not state, so falling back to an older card is harmless: the line carries that card's date.

`earlierNote(cards, { cartLive, plansLive })` formats it:

```
<earlier_cards>
Cards shown earlier in this chat. They are read-only and nothing from them is live in this session. Prices and availability are from the date shown and may have changed. If the user wants to continue one, search again (shop with new_cart, the items and the stores) or set the plan again; don't quote these totals as current.
cart (shown 2026-11-01): corn tortillas ×2, black beans ×4, avocados ×6 at Trader Joe's; best $18.40 at Trader Joe's
trip big-sur/weekend (shown 2026-11-01): Big Sur, 2026-11-14 to 2026-11-16, 2 travelers, budget $900, 1 stays shortlisted, 2 days planned
</earlier_cards>
```

- Cart line: the first store's items as `query ×qty` (×1 omitted), the store names in card order, and the lowest `total` among stores with no `missing` items, else the lowest total, formatted with that store's `currency`.
- Plan lines reuse `entityDetail` from `workspace/summary.ts`.
- The whole note is capped at 600 characters, like the workspace summary; the cart line goes first.
- The cart line is shown only while the session's cart is empty (`cartLive` false). Plan lines are shown only while the session's workspace holds no event, trip or shortlist. Once the session has its own state of that kind, the `<workspace>` note describes it instead.

Wiring:

- `seedHistory` returns `{ history, earlier }` from the stored rows it already loads, and `earlier` even when the text history is empty.
- `CreateSession(owner, ctx, persona, seed?: { history?: HistoryMessage[]; earlier?: EarlierCards })`, and `SessionStore.getOrCreate` passes the seed through. An existing session gets no seed, as today.
- `sessionFactory` keeps `earlier` in the session closure and builds the context note as `joinNotes(await workspaceNote(workspace), earlierNote(earlier, …), editsNote, openReport)`.

### Edits a session can't apply

A pane can show a live card whose session is gone: the tab was left open past the 30-minute idle sweep (the common case), the persona changed, or the container restarted. The user edits the card and sends a message. Today the database-backed store makes this work. Without it, the edit would vanish.

So `runTurn`, after reading `workspace_edits`:

- applies cart edits only if `entry.cart` is not empty, and event/trip edits only if `entry.workspace` holds an entity of that kind (as today);
- collects the rest and sets a one-turn note through `entry.setEditsNote(note | undefined)` (the same pattern as `setOpenReport`), cleared at the start of every turn:

```
<unapplied_edits>
The user changed a card from earlier in this chat, but this session doesn't hold it, so nothing was applied: avocados ×8; removed black beans; Trader Joe's corn tortillas → "Mission white corn tortillas". If the user wants that cart, search again with these changes. Don't say the change was saved.
</unapplied_edits>
```

Event/trip edits read the same way ("guests 16, date 2026-11-20 on the event card"). Each line is built from the parsed `WorkspaceEdits`; the note is capped at 600 characters.

This is the only piece of the old rebuild that stays, and it needs no new storage: the edits arrive with the message.

## Live versus locked

### The rule

In a chat pane, a cart or plan card is **live** only when both hold:

1. **It arrived in this mounted pane.** `ChatSession` adds the tool-call id to `arrived: Set<string>` (state) in its existing `onToolCallStartEvent` handler when `event.toolCallName === "show_widget"`. Cards from `props.history` are never in `arrived`. (In CopilotKit 1.83 a remounted pane gets a fresh agent, so history is the only other source of cards.)
2. **It is the newest of its kind in the pane.** For carts this is the existing `latestCart`; for plans the existing `latestPlans` (newest per `entity:id`).

Every other cart or plan card is **locked**, through the cards' existing `locked = stale || !onEdit`:

- **Replaced** (not the newest): unchanged. "Updated cart below" / "Updated plan below", 70% opacity. This applies to history cards too.
- **Earlier** (the newest, but not arrived in this pane): `onEdit` is not passed, so the card is locked by the existing rule, and it shows the dated line.

`TurnView` gets `arrived: ReadonlySet<string>` and `shownAt: Readonly<Record<string, string>>`. For each cart or plan item it passes to `WidgetRenderer`:

- `staleCart` / `stalePlan`: unchanged (not the newest);
- `onCartEdit` / `onPlanEdit`: only when `arrived.has(item.id)`;
- `lockedAt`: for a newest card that didn't arrive, `shownAt[item.id] ?? null`; otherwise `undefined`.

`WidgetRenderer` forwards `lockedAt` and the persona name (`agentName`) to `CartCard` and `PlanCard`.

### Why this rule

The browser can't see whether the agent's session still holds a card, and a remounted card has lost its local edit state. Locking everything loaded from history is honest and matches the owner's rule: old cards hold the chat together; re-asking gets fresh ones. A live card whose session was swept is covered on the agent side by "Edits a session can't apply".

### Cases

| Situation | Result |
|---|---|
| A run in this pane shows a cart | Live (newest). The previous cart in the pane becomes replaced. |
| Reload the page | All cards come from history → newest is earlier-locked and dated; older ones say "Updated cart below". |
| Switch to another chat and back (pane unmounted) | History is reloaded → locked and dated. The session may still be alive and the user can ask in words ("make it 3 avocados"); the agent's `shop` follow-up works on the live session cart. |
| Go to Reports or Search and back (pane stays mounted, `activeId` unchanged) | Unchanged: the pane never unmounted. |
| Resize across breakpoints | Unchanged (same `ChatPane` instance). |
| Two chats running in two mounted panes | Each `ChatSession` has its own `arrived` set and `idPrefix`. |
| The same chat open in two browser tabs | The tab that ran shows a live card; the other tab's copy came from history → locked. If both ran, each has a live card; edits are by item query and apply to the one session cart. Documented, not prevented. |
| Tab left open past the 30-minute idle sweep, then the user edits the live card and sends | The card is still live in the pane. The new session has no cart, so the edits go to the model as `<unapplied_edits>` next to `<earlier_cards>`; the model re-searches if the user wants it, and the new card replaces the old one. |
| A run fails before showing the card | Nothing arrives; nothing changes. |
| Interrupted run that did show a card | The card arrived → live if newest. |

### Card dates

A new `cardDates(items: StoredMessage[]): Record<string, string>` in `web/lib/chats.ts` maps each `show_widget` part id whose widget kind is `cart` or `plan` to its row's `createdAt`. `Thread` gains `cardDates?: Record<string, string>`, set by the `loaded` action next to `history`. `ChatPane` passes it to `ChatSession` as `shownAt`. `toHistory` is unchanged.

## Card UI

### `CartCard`

New props: `lockedAt?: string | null` (`undefined` = not earlier-locked; `null` = earlier, date unknown), `agentName?: string`, `now?: Date` (tests).

`locked` stays `stale || !onEdit`. The existing locked rendering is reused: swap, alternatives and remove are hidden, the stepper is disabled, store tabs still switch, and product links and the "Continue on X ↗" hand-off stay `ExternalLink`s (an `a` only for `http:`/`https:` URLs).

When `lockedAt !== undefined`, under the header:

- `<p id="${id}-locked-note" className="mt-1 text-xs text-text-muted">` reading **"Prices from {date} · ask {agentName} to refresh"**, or "Prices may be out of date · ask {agentName} to refresh" when `lockedAt` is `null` or not a valid date.
- The header count still shows the item count.

### `PlanCard`

Same `lockedAt`, `agentName` and `now` props; `locked` is unchanged. An earlier-locked plan shows `<p id="${id}-locked-note">` **"From {date} · ask {agentName} to update it"** ("From an earlier session · ask {agentName} to update it" when the date is unknown). Inputs stay disabled, as today.

### Date format

`cardDate(iso, locale, now)` in `web/lib/dates.ts`: the same calendar day → time only (`3:10 PM`); the same year → `Nov 1`; otherwise `Nov 1, 2025`. Invalid ISO → `null` (the "unknown" copy).

### Ids

New elements derive from the card's root id (`widgetId(kind, toolCallId, idPrefix)`, which already includes the pane prefix): `${id}-locked-note`. The new tab is `mobile-tabs-search` with `mobile-tabs-search-icon`.

## UX copy

| Where | Copy |
|---|---|
| Earlier cart, date known | "Prices from {date} · ask {name} to refresh" |
| Earlier cart, date unknown | "Prices may be out of date · ask {name} to refresh" |
| Earlier plan | "From {date} · ask {name} to update it" / "From an earlier session · ask {name} to update it" |
| Replaced card header (unchanged) | "Updated cart below" / "Updated plan below" |
| Phone tab | "Search" |
| `/plans`, `/plans/…` | Existing shell not-found: "This page doesn't exist." · "Back to chat" |
| Step label for `plan set`/`patch` | "Updated the event" / "Updating the event" |

`{name}` is the persona name (`persona.name`), as used elsewhere in the chat.

## Agent prompt and tools

- `tools/plan.ts` `DESCRIPTION`: "The chat's saved plan state" → "This chat's plans for the current session"; "The workspace summary at the top of each turn lists what is saved." → "The workspace note at the top of each turn lists the current plans; they last for this session only and aren't saved anywhere else." The field lists, patch example and the rest stay.
- `tools/plan.ts` results: the `set` verb "Saved" → "Set" ("Updated" stays for patch). `No ${kind} "${id}" is saved in this chat.` → `No ${kind} "${id}" in this session.`; `No ${kind} is saved in this chat.` → `No ${kind} in this session yet.`; `No ${kind} "${id}" is saved yet; use set first.` → `No ${kind} "${id}" in this session yet; use set first.`
- `tools/shop.ts` description: after "new_cart only for an unrelated list." add "To re-price the whole cart, or to continue a cart from an earlier card, pass new_cart with its items and stores."
- `workspace/cart.ts` `workspaceNote`: "Saved plan state for this chat (the user can edit it in the cards; trust it over earlier messages):" → "This chat's working state for this session (the user can edit the latest cards; trust it over earlier messages):".
- `prompt/systemPrompt.ts`: no change. It never claims plans are saved or visible in a Plans section.
- Skills (`party-planning`, `trip-planning`, `grocery-run`): no change (verified: no "saved"/"workspace"/"Plans" wording).

## Edge cases

| Case | Behaviour |
|---|---|
| The user emptied the cart, then the session was swept | `<earlier_cards>` describes the last cart card with its date. The model treats it as history; it is not live. |
| The newest card is older than the 200-row window, or the 500,000-character fallback dropped the cards | No `<earlier_cards>` line for it. The user re-asks. |
| The reply holding the newest card failed to save (`not_saved` banner shown) | `<earlier_cards>` shows the previous card. The user saw "This reply wasn't saved". |
| Persona change mid-run (`retireUser` marks the busy entry retired) | The run finishes on the old session; the next run creates a new session with `<earlier_cards>`. |
| Pending, unsent edits on a live card, then reload | Lost (they lived only in `CartCard` state). After the reload the card is locked; the user asks. |
| A history cart with a `javascript:` pick URL | Rendered as text (`ExternalLink`). |
| `/api/plans` or the agent's `/plans` called directly | 404 (no route). |
| Signed out, `/login?next=/plans` | `safeNext` → `/`. |
| Existing rows in `workspace_entities` | Never read; not shown. |

## Database

- No migration in this change. `workspace_entities`, `workspace_put`, `workspace_counts` and their indexes stay.
- No runtime path reads or writes them (`grep -rn "workspace_entities\|workspace_put\|workspace_counts" agent/src web shared` matches only `agent/src/db/database.types.ts`).
- `database.types.ts` stays unchanged: it is generated output, and regenerating now would produce the same file.
- `rls.int.test.ts` keeps its checks that the table and both functions are closed to `anon`/`authenticated` and that `workspace_counts` is invoker-rights with an empty `search_path`. These check objects that still exist and could still be exposed by mistake.
- Supabase advisors: none expected to change (no DDL). Run `get_advisors` (security and performance) after deploy and record the result in the Build notes.

### Follow-up migration (written, not applied)

Applied only after the owner explicitly confirms the drop, in its own PR and migration file `supabase/migrations/<version>_drop_workspace_entities.sql`. Until then this SQL lives only in this spec:

```sql
drop function if exists public.workspace_counts(uuid);
drop function if exists public.workspace_put(uuid, uuid, text, text, jsonb, integer);
drop table if exists public.workspace_entities;
```

Checked against the live schema: the function signatures match `pg_proc`, nothing else depends on the table (no views, publications, triggers, policies or other functions), so no `cascade` is needed. Dropping the table also drops its three indexes (`workspace_entities_pkey`, `workspace_entities_chat_user_idx`, `workspace_entities_user_recent_idx`), its two foreign keys and its four check constraints, so separate `drop index` statements are unnecessary. The functions go first because their bodies name the table. No backup step: the rows are operational state the owner has declared disposable (6 rows, 1 user at the time of writing).

That PR also:

- regenerates `agent/src/db/database.types.ts` (the `workspace_entities` table and both functions disappear);
- removes `workspace_entities` from the table list, the `workspace_put`/`workspace_counts` checks and the two index names in `agent/test/supabase/rls.int.test.ts`;
- runs `get_advisors` and records the result;
- leaves the historical migrations (`20261101060645_chats_workspace.sql`, `20261101214044_app_shell_search.sql`, `20261101225832_workspace_counts.sql`) untouched.

## Search

Nothing to remove: search covers chats (titles and message `content`) and reports (titles). Plans were never in it, and `scope=plans` already returns 400. Checks for the build:

- The scope tabs read All · Chats · Reports with counts (unchanged).
- The `SearchView` empty and help copy doesn't mention plans (verified: no "plan" string in `web/components/search/`).

## Architecture explainer notes

Replacement text for the explainer page, for the owner to apply separately:

- **Sections.** The shell has three sections: Chats, Search and Reports. Plans was removed on 2026-11-02.
- **Working state.** Carts, trips, events and shortlists live in the agent's session for the chat (`ActiveCart` and an in-memory workspace store). They are not saved anywhere else and end with the session (30 minutes idle, a restart, or a persona change).
- **History.** The transcript (`chat_messages.parts`) keeps every card the user saw, for display. A new session gets a short read-only note about the last cards and their dates; to continue, the agent searches again.
- **Cards.** Only the newest card that arrived in the open pane can be edited. Cards from history are read-only and dated.
- **Database.** `workspace_entities` is unused and kept until the owner confirms the drop.
- **Reports** are unchanged: `artifacts` table, Storage, the Reports section and the report panel.

## Testing

### Web unit and component tests (vitest, Testing Library)

- `test/chat/history.test.ts`: `cardDates` maps only cart and plan `show_widget` parts to their row's `createdAt`.
- `test/widgets/cart.test.tsx`:
  - live (`onEdit` set) shows dec, inc, swap and remove, enabled;
  - earlier-locked (`lockedAt` ISO, no `onEdit`): dec and inc disabled, no swap, remove or alternatives, the note "Prices from Nov 1 · ask Sage to refresh", store tabs still switch;
  - `lockedAt: null` and an invalid ISO → "Prices may be out of date · ask Sage to refresh";
  - replaced (`stale`) still says "Updated cart below" and has no locked note;
  - a `javascript:` pick URL and hand-off URL render as text when locked.
- `test/widgets/plan.test.tsx`: earlier-locked plan shows "From Nov 1 · ask Sage to update it" with disabled inputs; step labels "Updated the event" / "Updating the event".
- `test/lib/dates.test.ts` (or the existing dates test): `cardDate` same day / same year / other year / invalid.
- `test/chat/components.test.tsx` (ChatSession with CopilotKit mocked, as in `chatHost.test.tsx`):
  - history containing a cart card → locked, dated from `shownAt`;
  - a `show_widget` cart streamed by a run → live (enabled controls); the history cart becomes replaced;
  - a second streamed cart → the first is replaced, the second live;
  - unmount and remount with history → the formerly live card is locked and dated;
  - plan cards: history plan locked; a streamed plan for the same `entity:id` live; a different `id` keeps its own state.
- `test/shell/*`: Rail has no `rail-plans`; `MobileTabs` renders Chat, Search, Reports, You, and `mobile-tabs-search` gets `aria-current="page"` on `/search`; navigating to `/plans` renders `shell-not-found-title`.
- `test/auth/safeNext.test.ts` and `test/api/routes.test.ts`: as in the removal list.

### Agent tests (vitest)

- `test/workspace/earlier.test.ts` (new):
  - `earlierCards` keeps the newest valid cart card and the newest valid plan per `entity:id` (at most 3, newest first), with each row's `createdAt`; skips invalid or unparsable cards; reads interrupted rows; skips rows without parts;
  - `earlierNote` renders the cart line (items, stores, best total with currency) and plan lines, stays within 600 characters, drops the cart line when `cartLive`, drops plan lines when `plansLive`, and is `undefined` when nothing is left.
- `test/agui/workspace.test.ts` (rewritten):
  - edits from the AG-UI context are applied to `entry.cart` / `entry.workspace` before the turn;
  - a new session for an existing chat is created with a seed holding `earlier`, and the context note contains `<earlier_cards>` with the card's date; `entry.cart` is empty;
  - an existing session gets no seed;
  - cart edits on a new session (empty cart) produce `<unapplied_edits>` listing them, for that turn only; event edits with no event do the same;
  - after `retireUser`, the next run gets a new seed;
  - `RunContext` has no `workspace` (type-level).
- `test/workspace/followup.test.ts`: "make it 16 kids" patches the event and changes only quantities with no new catalog search (on the memory store); the summary reflects the patched event. "reloads the cart from the workspace into a new session" becomes "a new session starts with an empty cart and an earlier-cards note"; "persists UI edits" becomes "applies UI edits to the session cart".
- `test/tools/plan.test.ts`: new description and result copy.
- `test/tools/toolRules.test.ts` (or a new `test/tools/shop.test.ts`; there is no shop unit test today): the `shop` description contains the `new_cart` re-pricing sentence.
- `test/session/sessionStore.test.ts`: `getOrCreate` passes the seed to `create` for a new session and not for an existing one.
- `test/app.test.ts`: `GET /plans` and `GET /plans/<uuid>/trip/dDE` → 404 for a signed-in user.
- `test/session/createSession.test.ts`: the factory builds a memory store and returns it as `entry.workspace`.
- `test/db/imports.test.ts`: no file under `agent/src` except `db/database.types.ts` contains `workspace_entities`, `workspace_put` or `workspace_counts`.

### Integration against Supabase (`npm run test:supabase`)

- `repos.int.test.ts`: the workspace cases are removed.
- `rls.int.test.ts`: unchanged.

### End-to-end (`e2e/app-shell.demo.spec.ts`)

Seed (`e2e/support/seed.ts`), replacing the entity rows:

- On `chats[2]` (the cart chat): its existing assistant row gets `parts` holding one `show_widget` cart card (Trader Joe's, the same three items and picks) and a text part, and `created_at` = `ago(0, 3)`.
- On the Big Sur chat: a trip `plan` card part on the existing reply, after the two report parts.
- Export `CART_CARD_ID` and `TRIP_CARD_ID` (the part ids) so the steps can build element ids (`#chat-pane-<chat>-cart-<CART_CARD_ID>`).

Steps:

- **Replace step 7 with "Cards from earlier sessions are read-only".** Open the cart chat. `…-locked-note` contains "Prices from" and "ask Sage to refresh"; inside the card, `[id$='-dec']` and `[id$='-inc']` are disabled and no `[id$='-swap']` or `[id$='-remove']` exists. Reload the page and repeat (still locked after a reload). Open the Big Sur chat: the trip card shows "From … · ask Sage to update it" and has no `input:enabled`. Step 3's live run in that chat ran earlier, so this also checks that a run in the pane doesn't unlock a history card.
- **Step 8:** drop the plan-detail deep link; change the `/plans/<chat>/trip/..` check to `extra.goto("/plans")` → `#shell-not-found-title` "This page doesn't exist." with `#rail` visible. The signed-out `next=/plans` case is covered by the `safeNext` unit test, not by an E2E sign-in.
- **Step 9:** axe paths become `/`, `/search?q=big`, `/reports` and `/chats/<cart chat>`, so the locked card and its note are contrast-checked in light and dark.
- **Step 10:** unchanged (it never touched `#rail-plans`).
- **Step 13 (phone):** tabs `#mobile-tabs-reports`, `#mobile-tabs-search` (`/search$`), `#mobile-tabs-chat`, each with `aria-current="page"` and no horizontal scroll at 390 px. The cart chat's locked card fits 390 px without horizontal scroll.

### Before each commit

`npm run build` in `web/`, the agent's `tsc --noEmit`, `npm test` in `agent/` and `web/`, `npm run test:supabase`, then a self-review of the diff. Rebuild and restart the Docker stack after the agent and web changes land, and run the E2E demo.

## Build order and commits

1. `feat(agent): keep plans in the session`: memory store on the session entry, `RunContext.workspace` removed, `earlier.ts` and the seed, `<unapplied_edits>`, plan and shop copy, workspace note copy, tests.
2. `refactor(agent): remove the plans endpoints and the workspace repo`: `http/plans.ts`, `plans/view.ts`, `cartWidget`, `WorkspaceRepo`, `SupabaseWorkspaceStore`, `server.ts` wiring, test fixtures and tests.
3. `feat(web): lock cards from earlier sessions and date them`: `arrived`/`shownAt`, `lockedAt` on `CartCard`/`PlanCard`, `cardDates`, `cardDate`, step labels, tests.
4. `refactor(web): remove the Plans section`: routes, API routes, components, `lib/plans.ts`, rail, phone tabs (Search tab), top bar, `useRoute`, `shared/routes.ts`, `shared/lists.ts`, `entityKey`, tests.
5. `test(e2e): locked cards, reloads and the removed Plans section`: seed and steps.
6. `docs: README and CONTRIBUTING without Plans`, plus Build notes in this spec.

Each commit builds and passes its tests on its own.

## Rollout

- Users have saved plans now (live: 6 rows, 1 user). After deploy, the Plans section, its rail icon and its phone tab are gone, and those rows are never read again. Nothing is migrated: a saved cart's prices are already stale, and the owner's rule is to re-ask.
- Chats keep their cards, shown locked and dated. The first message in such a chat after deploy gets `<earlier_cards>`.
- Live agent sessions at deploy time are discarded by the container restart.
- Bookmarks to `/plans` show the shell's not-found page.
- No feature flags: the change ships whole.
- The drop of `workspace_entities` waits for the owner's explicit confirmation (see "Follow-up migration").

## Builder's calls in this spec (summary)

- Not-found, not a redirect, for removed routes.
- Search becomes the phone tab that replaces Plans.
- No rebuild on a new session; a read-only `<earlier_cards>` note instead.
- Edits that reach a session without the card become a one-turn `<unapplied_edits>` note.
- Live means "arrived in this mounted pane and newest"; everything from history is locked through the cards' existing `locked` state.
- No refresh chip; the dated line tells the user to ask.
- `database.types.ts` and the RLS checks for the table stay until the drop.

## Open questions for the owner

None. The one decision reserved for the owner, confirming the drop of `workspace_entities`, is handled by "Follow-up migration".

## Review changes

Reviewed against the code at `efaf060`, CopilotKit 1.83.0 in `web/node_modules`, and the live schema (read only). The owner's intent is that cards structurally hold the chat together and that re-asking gets a fresh cart, so the review cut the rebuild machinery.

Cut:

- **Transcript rebuild of a live cart and plans** (`rebuild.ts`, `seed`/`restoredFrom` on the store and the cart, `cartFromWidget`, restored-price notes). It existed to bring an old cart back live after a session was recreated, which the owner sees little value in: prices change and the user re-asks. Replaced by the read-only `<earlier_cards>` note.
- **`storeIds` on cart cards.** It only served the rebuild.
- **`workspace_edits` transcript parts on user rows** and their stripping in `GET /chats/:id/messages` and `toHistory`. They only served replaying edits in the rebuild. Edits keep travelling as the AG-UI context item, as today.
- **`working_state` marker parts** and the `parts()` changes. They only stopped the rebuild from restoring a cart that had changed without a card.
- **Removing the one-card-per-kind-per-run rule for carts.** It only kept the newest saved card in step with the cart for the rebuild. In-session state lives in `ActiveCart`, so the rule stays.
- **`shop refresh: true`.** One description sentence pointing at `new_cart` covers re-pricing with the existing tool.
- **The "Refresh prices" chip.** It was more than a button (newest-only logic, hidden while running, wiring, tests, E2E), and `shop` had no refresh path without the cut parameter. The dated line already says "ask {name} to refresh".
- **"No controls" rendering for locked cards.** The cards' existing `locked` state (stepper disabled; swap, alternatives and remove hidden; plan inputs disabled) is reused unchanged.

Kept, with the failure it prevents:

- **Session-held memory store, `RunContext.workspace` removed.** Without it, `server.ts`'s per-run store and the session's store would be two separate memory stores: the plan tool would write to one, and UI event/trip edits and the evidence summary would read the other, so "make it 16 kids" from the card would be lost in a live session.
- **`<unapplied_edits>`.** The session idles out after 30 minutes (`SESSION_IDLE_MS`, swept every minute), while a pane stays mounted and its card stays live. A user who builds a cart, steps away for lunch, changes a quantity and sends a message would otherwise lose the edit silently: the new session's cart is empty and `ActiveCart.applyEdits` reports nothing. This is normal use, not a rare restart, so the edits are shown to the model.

Corrected:

- CopilotKit 1.83 does **not** keep an agent's messages across a pane remount: `useAgent` with `runtimeAgentId` registers a new proxied agent per mount and unregisters it on unmount. The "cached messages after a remount" case and its test were removed; the remount test now reloads history. The "date unknown" copy stays only as a fallback for a missing or invalid date.
- Plan-tool copy quoted a message that doesn't exist (`No {kind} is saved yet; use set first.`) and missed `No ${kind} is saved in this chat.`; both are now quoted from the source.
- E2E: step 10 never referenced `#rail-plans`, so its "change" was dropped. The signed-out `next=/plans` sign-in check moved to the `safeNext` unit test. The existing `/plans/<chat>/trip/..` not-found check is kept as `/plans`. `Seeded.tripChat` and the `TRIP_ID` import are removed.
- Removal list additions: `agent/test/fixtures/app.ts` (its own `SupabaseWorkspaceStore` in `runContext`), the `workspace_entities` entry in `agent/test/db/imports.test.ts`'s allowed tables, `README.md` line 90 ("seeds … plans"), `MobileTabs`'s `SquareCheckBig` → `Search` import, `ENTITY_ID_MAX` being used only by `entityIdFromKey`, and the `scope=plans` search tests that stay. `ShellOverlays`, `AccountSheet`, `MobileDrawer`, the system prompt, skills, rate-limit keys and `cleanup-e2e.mjs` were checked and need no change.
- Follow-up migration: verified against the live schema. The redundant `drop index` statements were removed (the table drop takes its indexes, foreign keys and check constraints), and the facts now say RLS is enabled with no policies rather than just "no policies".
- `seedHistory` is wired to return `earlier` even when the text history is empty, so a chat whose rows hold only cards still gets the note.
