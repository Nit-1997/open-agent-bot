# Report side panel

Status: proposed · 2026-11-01 · branch `feat/supabase-auth`

Review basis: the three report mockups the owner approved (Design canvas "Open Agent Layout Mockups", section "Reports: side panel with adjustable width": `ReportPanel` (desktop, 1440×900), `MobileReportCard` and `MobileReportViewer` (390×844)), with `Main` and `Collapsed` for the shell around them; the web and agent source at `f033838`; the installed `next` 16.4.3 (`web/node_modules/next/dist/docs` and `dist/client/components/app-router.js`); and the app shell spec (`2026-11-01-app-shell-and-agent-persona-design.md`) with its Build notes. Decisions marked **builder's call** are mine, made where the brief left room. Everything else comes from the owner's brief.

**Dependency.** This spec assumes report cards survive a reload. That is commit `f033838` ("fix(chats): save report and widget tool calls so they survive a reload"): the run writes `create_artifact`, `research` and `show_widget` calls with their results to `chat_messages.parts` (migration `20261102000000_chat_message_parts.sql`, which also backfills old reports as `saved-<artifactId>` tool calls), and `web/lib/chats.ts` `toHistory` rebuilds them as tool calls. The panel's "n of m in this chat", the cards and the reload checks below all rely on it. Nothing here changes that code. The one place this spec touches its output is the E2E seed (a second report part on the Big Sur reply, see "Testing").

## Why

A report is shown today as a 520–640 px sandboxed iframe in the middle of the chat (`ArtifactCard`), with a full-screen dialog (`ArtifactViewer`) as the only larger view. A long report pushes the conversation off screen, a second report doubles that, and you can't keep reading the report while asking about it. The Reports section has its own copy of the viewer (`ReportDetail`). The owner approved a layout where reports open in a panel next to the chat, and the chat shows a compact card.

## Goals

- On desktop (≥1024 px), reports open in a right-hand panel beside the chat. The sidebar gives way to the icon rail while the panel is open and comes back when it closes.
- A keyboard-accessible, draggable separator between chat and panel, with the width remembered per device.
- A panel header with the title, "Report · n of m in this chat", previous/next, Download PDF, Open in new tab and Close.
- In the chat, a compact card (first-page thumbnail, title, "Report · open on the right") that opens or swaps the panel and shows which report is open.
- The panel opens by itself when a report finishes during a live run in the chat the user is looking at. It never opens by itself on reopening a chat or after a reload, and it never takes focus from the composer.
- The open report is in the URL (`/chats/<id>?report=<artifactId>`), so it can be linked and survives a reload.
- Tablet: the panel slides over the chat as an overlay. Phone: a full-screen viewer whose back arrow and the browser's Back both close it.
- One viewer component, used by the chat panel, the tablet overlay, the phone viewer and the Reports section's report page.

## Non-goals

- Editing, renaming, deleting or sharing reports.
- Thumbnails in the Reports grid. The stored thumbnail makes this cheap later, but the grid keeps its icon tiles in this build.
- Telling the agent which report is open (see "Open questions").
- Showing carts, plans, weather, flights, stays or any other widget in the panel. They stay inline.
- More than one panel per chat pane, or reports from another chat in a chat's panel.
- A server-side list of a chat's reports. The chat's own turns are the list (see "Data and API changes").

## Anti-goals (failures even if it works)

- The panel opens by itself when the user reopens a chat, reloads, or comes back to a chat whose report finished while they were elsewhere.
- Focus leaves the composer because a report finished (including a report's own script calling `focus()`).
- The report iframe reloads when the user goes to another section and back, switches between mounted chats, or resizes across a breakpoint.
- The iframe loses its `sandbox` attribute, the HTML loses `ARTIFACT_CSP`, or a report link opens a non-http(s) URL.
- A thumbnail or report of user A is served to user B, or an uncached PDF/thumbnail render can be triggered without a rate limit.
- Duplicate HTML ids when two or three chat panes are mounted, each with a panel.
- A panel toggle on desktop that adds a history entry, or a phone viewer that Back doesn't close.
- A layout at 1024 px where the chat column or the panel is too narrow to use, or horizontal page scroll at 360 px with the viewer open.
- A failed or missing report that looks like a blank panel.

## Decisions at a glance

| Topic | Decision |
| --- | --- |
| Placement | One `ReportPanel` per `ChatPane`, rendered inside the pane at a fixed tree position. Desktop: inline to the right of the chat column. Tablet: a modal overlay over the chat area. Phone: a full-screen modal viewer. Same element at every breakpoint (only classes and roles change), so a resize never reloads the iframe. |
| Viewer | One `ReportViewer` (header, states, `ArtifactFrame`) used by the panel (`variant="panel"`), the phone viewer (`"screen"`) and `/reports/[id]` (`"page"`). `ArtifactViewer` (the full-screen dialog) and the inline 520 px card are deleted. |
| Card thumbnail | A stored JPEG of the report's first screen, rendered once by the agent's existing Chromium (the one that prints PDFs), cached in Storage next to the HTML and PDF, served at `/api/artifacts/<id>?format=thumb`. Not a scaled iframe (see "Card thumbnail: stored image, not a scaled iframe"). |
| Per-chat state | The open report is kept per chat in `chatController` (`panels[threadId]`) for the page session, including for chats whose pane unmounted. On desktop, coming back to a chat restores its panel. On tablet and phone, arriving at a chat never opens the modal viewer unless the URL asks for it. |
| URL | `?report=<artifactId>` on `/chats/<id>` only. `parseRoute` validates it with `ARTIFACT_ID_RE`, `hrefFor` emits it, so `safeNext` keeps it through sign-in. Desktop and tablet **replace** the entry (a panel toggle doesn't eat Back, like every other shell overlay); phone **pushes** (the viewer is a screen, and Back must close it). |
| Auto-open | Desktop only, on a `TOOL_CALL_RESULT` for `create_artifact` or `research` that carries an artifact id, received live by the active, visible pane, with no shell overlay open, unless the user closed the panel or picked a report by hand during this run. Never moves focus. Tablet and phone announce "Report ready" instead (**builder's call**: their viewer is modal, and a modal must take focus). |
| Sidebar | While the panel is shown inline, the sidebar renders as collapsed (derived, never written to `oa.sidebar`). The rail's sidebar toggle then opens the sidebar as the overlay the tablet uses. Closing the panel brings the inline sidebar back unless the user had collapsed it. |
| Widths | Separator 12 px. Chat column ≥ 360 px, panel ≥ 380 px, panel default 58 % of the chat + panel area (the mockup: 800 of 1372 px). Stored as a fraction in `localStorage["oa.reportPanel"]`, read and written in try/catch. |
| Rate limits | New `artifacts` limit on every `/artifacts/*` request (none today), a `renders` limit charged only when a PDF or thumbnail must be rendered, and one render at a time per user. |

## Verified facts (checked against the source)

| Claim | Result | How it was checked |
| --- | --- | --- |
| A PDF download exists | **True.** `GET /artifacts/<id>.pdf` renders the stored HTML with Chromium (`ArtifactStore.renderPdf`, A4, `printBackground`, internal requests blocked), caches it in Storage as `<user>/<id>.pdf`, sets `artifacts.pdf_path`, and dedupes concurrent renders. The web proxies it at `/api/artifacts/<id>?format=pdf` with `content-disposition: attachment`. No new PDF work is needed. | `agent/src/artifacts/store.ts`, `agent/src/http/artifacts.ts`, `web/app/api/artifacts/[id]/route.ts` |
| `/artifacts/*` is rate limited | **False.** `artifactRoutes` gets no limiter (`app.ts` passes only `artifacts` and `owner`). Renders share two global Chromium slots (`PDF_RENDERS = 2`) with no per-user fairness, so one user can keep both busy. | `agent/src/app.ts`, `agent/src/artifacts/store.ts` |
| The Storage bucket accepts images | **False.** `artifacts` allows `text/html` and `application/pdf` only, so a thumbnail needs a migration. | `supabase/migrations/20261101060651_artifacts.sql` |
| The app CSP lets the page show a thumbnail and frame a report | True: `img-src 'self' data: https:`, `frame-src 'self'`, and `next.config.ts` exempts only `/api/artifacts/` from `X-Frame-Options: DENY`. | `web/lib/csp.ts`, `web/next.config.ts` |
| `pushState`/`replaceState` sync with `useSearchParams` and keep custom state | True. The Next 16.4.3 docs say both sync with `usePathname` and `useSearchParams`. The patched methods call `copyNextJsInternalHistoryState(data)`, which adds Next's keys to the object passed in and keeps the caller's keys, so `{ oaReport: id }` survives. | `docs/01-app/01-getting-started/04-linking-and-navigating.md`; `dist/client/components/app-router.js` lines 128–140, 285–313 |
| The chat route reads its query | **False.** `parseRoute` ignores the query for `/` and `/chats/<id>`, and `ChatHost` calls `parseRoute(pathname)` without params. Both change. | `shared/routes.ts`, `web/components/chat/ChatHost.tsx` |
| Reports come only from `create_artifact` | **False.** `research` also yields an artifact item (`lib/turns.ts` reads the title from its result, `artifact <id> created: <title>`). Both tools count as reports everywhere below. | `web/lib/turns.ts`, `agent/src/tools/research.ts` |
| A live run tells the browser when a report is saved | True. The agent emits `TOOL_CALL_RESULT` (`agui/events.ts` `toolResult`), and `@ag-ui/client` exposes `onToolCallResultEvent` on `agent.subscribe`. History loaded with `agent.setMessages` emits no such event. | `agent/src/agui/events.ts`, `web/node_modules/@ag-ui/client/dist/index.d.ts` |
| The card ids are already asserted | True. The persistence fix's E2E checks `#chat-pane-<chat>-artifact-card-<toolCallId>` and its `-title` after a reload. The new card keeps that root id and `-title`. | `e2e/app-shell.demo.spec.ts` step 6 |
| An iframe can go inside the card's button | **False.** A `button` may not contain interactive content, and `iframe` is interactive content (HTML Living Standard, content models). | Spec |

## UX per breakpoint

### Desktop (≥1024 px), as in `ReportPanel`

```
| rail 68 | chat column (flex, ≥360) | ‖ 12 | report panel (fraction, ≥380) |
```

- The chat column keeps `ChatHeader`, the turns and the composer. Its content stays centred with the existing 760 px cap, so a wide chat column looks the same as today.
- The separator is a 12 px strip with a 1 px `surface-accent` rule and a 6×44 px `border` grip (mockup).
- The panel is an `aside` (`aria-label="Report"`) on a new `--panel` background (dark `#16171b` from the mockup, light `#f4f2ef`; **builder's call**, axe-checked). The header is 64 px, matching `ChatHeader`'s height so the two bottom rules line up (the mockup draws both at 60; **builder's call**). From left to right:
  - a 30 px `FileText` tile (`paper` background, `mist` icon);
  - the title (14 px, 500, truncated with a `title` attribute, inside `<bdi>`) over the position line in DM Mono 11 px, uppercase by CSS: "Report · 1 of 2 in this chat" (one report: "Report");
  - **Previous report** and **Next report** (36 px icon buttons), only when the chat has more than one report. At either end the button gets `aria-disabled="true"` and the muted colour, but stays focusable, so focus doesn't drop to `body` when the user reaches the end;
  - a 1 px divider;
  - **Download PDF** (a bordered link with icon and text, `href=/api/artifacts/<id>?format=pdf`, `download`);
  - **Open in a new tab** (icon link, `target="_blank" rel="noopener noreferrer"`, `href=/api/artifacts/<id>`);
  - **Close report** (icon button).
- The body has 20 px padding around `ArtifactFrame`, which has a 12 px radius and a white background (mockup).
- While the panel is shown, the sidebar is collapsed to the rail and the rail shows New chat (the `Collapsed` mockup's rail).

### Tablet (768–1023 px)

The same panel, as a modal dialog sliding in from the right over the chat area. Width is `min(100vw − 68px, 880px)`, so the rail stays visible and at 1000 px a 52 px sliver of the chat shows behind the backdrop. Header as on desktop (there is room for previous/next at 700 px). No separator. Backdrop tap, Close and Escape close it.

### Phone (<768 px), as in `MobileReportViewer`

A full-screen dialog over the top bar and tabs, on `--panel`, padded for `env(safe-area-inset-*)`. The header (64 px) has **Back to chat** (arrow, 44 px), the title (15 px, truncated) over "Report", then **Download PDF** and **Open in a new tab** as 44 px icon links. No previous/next and no separator (mockup). The report fills the rest edge to edge. The browser's Back closes it too (see "Routing").

### The card in the chat, as in `ReportPanel` and `MobileReportCard`

- A `button` (`aria-pressed`, `aria-label="Open report: <title>"`), 320 px wide on desktop and tablet, full width on phones. It has a `surface` background, a 16 px radius and a `surface-accent` border.
- Top: the thumbnail, 128 px tall (150 px on phones), `object-fit: cover; object-position: top`, decorative (`alt=""`). If the thumbnail can't load, the existing accent-gradient tile with a `FileText` icon takes its place.
- Bottom row: the 30 px `FileText` tile, the title (truncated), and "Report · open on the right" (desktop) or "Report · tap to read" (tablet, phone).
- Pressed (its report is the one shown): a `mist` border and a 3 px `mist` ring at 18 % (mockup), not colour alone: `aria-pressed="true"`.
- While the report is being written, a card of the same size with a pulsing thumbnail skeleton, the title from the tool arguments (or "Report"), "Writing the report…", and `role="status"`. It is not a button.
- A failed `create_artifact` keeps today's line, "Couldn't create the page: …".

## Card thumbnail: stored image, not a scaled iframe

**Decision:** the agent renders a JPEG of the report's first screen once, stores it next to the HTML, and the card shows it with `<img loading="lazy">`.

**Why not a scaled iframe:**

- **It isn't valid inside the card.** An `iframe` is interactive content and can't sit inside the card's `button`. Layering it under the button works around that, but leaves an extra focusable browsing context in the accessibility tree of every turn.
- **It's heavy.** Each preview loads the full report (up to 5 MB, with `data:` images) and runs its scripts (`allow-scripts`). A chat with four reports means four extra documents per mounted pane, up to three panes, plus the panel. That is the same cost the app shell spec turned down for the Reports grid.
- **It doesn't look like the page.** The scaled render depends on a fake layout viewport and on Google Fonts loading inside each preview.

A stored image costs one Chromium render per report. That is the same machinery and guard as the PDF, which already runs on demand. The card then costs one small private image request.

**How:**

- `ArtifactStore.thumbnail(owner, id)`, built like `renderPdf`. It returns the cached `<user>/<id>.jpg` when `thumb_path` is set. Otherwise it renders under the per-user and global render slots, uploads with upsert, and sets `thumb_path`. Concurrent requests share one render (key `${userId}:${id}:jpg`).
- The renderer uses the same Chromium context setup as the PDF (`blockInternalRequests`, `setContent` with `waitUntil: "load"`, 20 s timeout), then waits for `document.fonts.ready` (capped at 3 s). It uses viewport 800×320 CSS px at `deviceScaleFactor` 1.5 and takes a `page.screenshot({ type: "jpeg", quality: 70, clip: 0,0,800,320 })`, giving a 1200×480 image. At 800 px the report kit is in its desktop layout: its only breakpoint is `max-width: 640px`. The 2.5:1 ratio is the desktop card's 320×128, and it is ≥2.5× the card's width, so it stays sharp on 2× screens. An image over 512 KB is not stored (the card keeps the placeholder).
- **Eager:** after `ArtifactStore.save` inserts the row, it starts the thumbnail render without awaiting it, and a failure is only logged. By the time the card mounts in a live run, the image is usually ready. The eager render goes through the global and per-user render slots, but it doesn't count against the user's `renders` rate limit (the agent started it, not a request).
- **Lazy:** a request for a missing thumbnail renders it. This covers reports saved before this ships (the backfilled `saved-…` cards) and an eager render that failed.

## Component and state design

### Component tree (changes only)

```
ShellFrame
├─ Rail                                   toggle opens the sidebar overlay while a panel is inline
├─ Sidebar                                open = sidebar.inline (derived)
└─ <main id="shell-main">
   ├─ ChatHost                            useRoute(); useReportUrl() keeps ?report= and panels in sync
   │  └─ ChatPane ×(1..3)                 section: flex-row on desktop
   │     ├─ <div id="<pane>-column">      ChatHeader + ChatSession (unchanged contents)
   │     │  └─ ChatSession → TurnView → ReportCard   (replaces ArtifactCard)
   │     ├─ PanelSeparator | null         desktop with a report open
   │     ├─ <div id="<pane>-report-backdrop"> | null   tablet and phone with a report open
   │     ├─ ReportPanel | null            same slot at every breakpoint
   │     │  └─ ReportViewer variant="panel" | "screen"
   │     └─ <p id="<pane>-report-status" role="status" class="sr-only">
   └─ {children}
      └─ ReportDetail                     /reports/[id] → ReportViewer variant="page"
ShellOverlays                             "sidebar" case also on desktop while a panel is inline
```

The pane's children are always `[column, separator | null, backdrop | null, panel | null, status]`. A `null` slot keeps the positions, so React never remounts the panel (and its iframe) when the separator or the backdrop comes and goes on a resize. This is the same rule `ShellFrame` uses for `main`.

### Files

New (web):

```
web/components/reports/ReportViewer.tsx     header + loading/missing/other-chat/error + ArtifactFrame; variants panel, screen, page
web/components/reports/ReportPanel.tsx      placement per breakpoint, modal behaviour, focus, Escape
web/components/reports/PanelSeparator.tsx   role="separator", pointer drag, keys
web/components/reports/ReportCard.tsx       compact card, pending and error variants (replaces ArtifactCard)
web/components/reports/ReportThumb.tsx      <img> with placeholder fallback
web/lib/reportRefs.ts                       parseArtifactId (moved), reportsIn(turns)
web/lib/shell/reportPanelPref.ts            read/write oa.reportPanel (try/catch)
web/lib/shell/panelWidth.ts                 clamp and step functions (pure)
web/lib/shell/inertOutside.ts               inert on everything outside an element, restorable
web/lib/shell/useReportUrl.ts               URL ⇄ panels sync (see "Routing")
web/lib/shell/autoOpen.ts                   shouldAutoOpen (pure)
```

Changed (web): `components/chat/ChatPane.tsx` (row layout, panel slot, report state wiring, status line), `components/chat/ChatSession.tsx` (`openReportId`, `onOpenReport`, `onReports`, `onReportReady` from `onToolCallResultEvent`), `components/chat/TurnView.tsx` (renders `ReportCard`, pending card), `components/chat/ChatHost.tsx` (`useRoute`, `useReportUrl`), `components/shell/ShellProvider.tsx` (report API, derived `sidebar.inline`), `components/shell/ShellFrame.tsx` (`Sidebar open={sidebar.inline}`, New chat on the rail while a panel is inline), `components/shell/ShellOverlays.tsx` (sidebar overlay on desktop while a panel is inline), `components/shell/Rail.tsx` (`chatHrefOf` carries `?report=`), `components/reports/ReportDetail.tsx` (thin wrapper over `ReportViewer`), `components/artifacts/ArtifactFrame.tsx` (forwards `onLoad` and a ref), `lib/shell/chatController.ts` (panels, run flags), `lib/reports.ts` (`reportThumbHref`), `app/api/artifacts/[id]/route.ts` (`format=thumb`; an HTML error page for frame navigations), `app/globals.css` (`--panel` token, card ring).

Deleted (web): `components/artifacts/ArtifactCard.tsx` (becomes `ReportCard`), `components/artifacts/ArtifactViewer.tsx` (the panel and the phone viewer replace it). Tests that render them (`test/artifacts.test.tsx`) move to the new component tests.

Changed (shared): `shared/routes.ts` (chat route `report`).

Changed (agent): `src/artifacts/store.ts` (`thumbnail`, eager render after `save`, per-user render slot, `PDF_RENDERS` renamed `RENDER_SLOTS`), `src/http/artifacts.ts` (`.jpg`, rate limits), `src/db/types.ts` (`ArtifactFile` gains `"jpg"`, `ArtifactRow.thumbReady`, `ArtifactRepo.setThumb`), `src/db/users.ts` (`setThumb`, `CONTENT_TYPE.jpg = "image/jpeg"`, upsert for `pdf` and `jpg`), `src/db/database.types.ts` (regenerated), `src/lib/rateLimit.ts` (`artifacts`, `renders`), `src/app.ts` (limiter to `artifactRoutes`), `test/fixtures/memoryRepos.ts`.

New (database): `supabase/migrations/<version>_artifact_thumbnails.sql`, with a version after `20261102000000`.

### State ownership

| State | Owner | Lifetime |
| --- | --- | --- |
| Which report each chat's panel shows, how it was opened, whether its history entry was pushed | `chatController` `panels: Record<threadId, Panel>` | Page session. It outlives pane unmounts; at most 20 entries, oldest dropped. Not in browser storage. |
| Per-run flags: the user closed the panel, the user picked a report | `Thread.runFlags`, reset when a run starts | Current run |
| The chat's report list (`ReportRef[]`) | `ChatSession` derives it from its turns and passes it up with `onReports` | While the pane is mounted |
| Report metadata (`ReportSummary`) | `ReportViewer` fetch, with a per-pane `Map` cache so previous/next back to a report doesn't refetch | While the pane is mounted |
| Panel width | `reportPanelPref` (`localStorage["oa.reportPanel"]`), read once into `ShellProvider` | Per device |
| Inline sidebar | Derived: `desktop && sidebar.open && !report.inline` | Derived; `oa.sidebar` untouched |
| `?report=` | URL, kept in step with `panels[activeId]` by `useReportUrl` | History |

`localStorage` now holds `theme`, `oa.sidebar` and `oa.reportPanel` (a number). No report id, title or content goes to browser storage.

### `chatController` additions

```ts
export type PanelHow = "user" | "auto" | "url";
export type Panel = { reportId: string; how: PanelHow; pushed: boolean };

ChatState.panels: Record<string, Panel>;
Thread.runFlags?: { dismissed: boolean; picked: boolean };

type ChatAction =
  | …
  | { type: "openReport"; id: string; reportId: string; how: PanelHow; pushed?: boolean }
  | { type: "closeReport"; id: string };
```

- `openReport` sets `panels[id]`. While the thread is running and `how === "user"`, it also sets `runFlags.picked`.
- `closeReport` deletes `panels[id]`. While the thread is running, it sets `runFlags.dismissed`.
- `running: true` resets `runFlags` to `{ dismissed: false, picked: false }`.
- `prune` leaves `panels` alone (that is the point), except to cap it at 20 by insertion order.

### `ShellApi` additions

```ts
report: {
  open(threadId: string, reportId: string, how: PanelHow): void;   // writes the URL for the active chat
  close(threadId: string): void;                                    // history.back() when the entry was pushed, else replace
  inline: boolean;                                                  // desktop, chat route visible, active thread has a panel
  width: number; setWidth(fraction: number): void;                  // stored fraction
};
sidebar: { open: boolean; inline: boolean; toggle(): void };        // toggle opens the overlay while report.inline
```

`report.open` and `report.close` are memoised and read state through `chatsRef`, as `newChat` does today.

### `ChatPane`

- The `section` becomes `flex-row` on desktop. The chat column (`<pane>-column`) is `flex-1 min-w-[360px]` with today's contents.
- Panel width on desktop: `panelPx = clampPanel(fraction, available)`, where `available` is the pane's width minus the separator (from a `ResizeObserver` on the section). `clampPanel` keeps the panel ≥ 380 px and the chat ≥ 360 px. At the narrowest desktop (1024 − 68 = 956 px) the panel can be 380–584 px.
- It receives `reports: ReportRef[]` from `ChatSession` and passes the pressed id and `onOpenReport` down. Clicking a card calls `report.open(threadId, reportId, "user")`, which opens the panel, or swaps it when another report is shown. Clicking the pressed card does nothing more: it is already shown, and Close is in the panel.
- It renders the status line `<pane>-report-status` (polite), used by the auto-open rules.
- It never mounts the panel for a pane that is not active, so `inertOutside` and the focus trap only ever run for the visible pane. A hidden pane keeps its panel element: the pane is `hidden` and `inert` as a whole, so the iframe stays loaded.

### `ReportPanel`

`{ id: "<pane>-report-panel"; threadId; reportId; reports: ReportRef[]; placement: "inline" | "overlay" | "screen"; width?: number; onClose(how: "button" | "escape" | "backdrop" | "back") }`.

- Inline: `aside aria-label="Report"`, `style={{ width }}`, non-modal.
- Overlay and screen: the same element gets `role="dialog" aria-modal="true" aria-labelledby="<id>-title"` and fixed positioning. It uses `useFocusTrap(ref, true)`, `inertOutside(ref.current, #shell-frame, [backdrop])`, and a document `keydown` listener for Escape. The backdrop (tablet only) closes on click.
- The panel element is the same at every placement. Crossing into a modal placement with the panel open moves focus to `<id>-title`, because everything outside is now inert and focus can't stay there. Crossing back to inline leaves focus alone.

`inertOutside(el, root, keep)` walks from `el` up to `root`. At each level it sets `inert` on every sibling that isn't in `keep` and wasn't already inert, and it returns a function that removes exactly what it set. It reaches the rail, the sidebar overlay slot, the top bar, the tabs and the chat column, but not the panel or `ShellOverlays` (which render outside `#shell-frame`).

### `ReportViewer`

```ts
{
  id: string;                      // "<pane>-report-panel" or "report-detail"
  reportId: string;
  variant: "panel" | "screen" | "page";
  fallbackTitle?: string;          // the card title while metadata loads
  chatId?: string;                 // set by the chat panel: a report from another chat shows "other chat"
  position?: { index: number; total: number } | null;
  onPrev?(): void; onNext?(): void; onClose?(): void;
  back?: ReactNode;                // page: the "All reports" link
  titleRef?: Ref<HTMLHeadingElement>;
}
```

- **Metadata first.** `reportsApi.get(reportId)` runs (per-pane cache), and the iframe mounts only after it returns, as `ReportDetail` does today, so a missing report never reaches the iframe. The title shows `fallbackTitle` until then, so the header doesn't flash.
- **States**, each inside the viewer body with the header (Close or Back) still usable:
  - loading: header skeleton and a pulsing body, `aria-busy`;
  - missing (404): "This report doesn't exist or isn't yours.";
  - other chat (`chatId` set and `report.chatId !== chatId`): "This report is from another chat." with a link "Open it in Reports" to `/reports/<id>`;
  - error: `ListState` "Couldn't load this report: …" with Retry;
  - ready: `ArtifactFrame` with `sandbox={ARTIFACT_SANDBOX}`, unchanged.
- **Title** is an `h2` (panel, screen) or `h1` (page) with `tabIndex={-1}` and id `<id>-title`, so focus can land on it.
- **Page variant** keeps today's `ReportDetail` content and ids (`report-detail-back`, `-from`, `-pdf`, `-frame`) and adds **Open in a new tab**. "From: <chat>" links to `/chats/<chatId>?report=<id>` on desktop, so the chat opens with that report on the right. On tablet and phone it stays `/chats/<chatId>`: opening a modal straight after leaving the report would only show the same report again.
- Ids: `<id>-header`, `-icon`, `-title`, `-title-bdi`, `-position`, `-prev`, `-next`, `-divider`, `-pdf`, `-pdf-icon`, `-new-tab`, `-new-tab-icon`, `-close`, `-back`, `-body`, `-loading`, `-missing`, `-other-chat`, `-other-chat-link`, `-error`, `-frame`.

### `PanelSeparator`

`{ id: "<pane>-report-separator"; panelId; fraction; min; max; onChange(fraction, commit: boolean) }`.

- `role="separator" aria-orientation="vertical" aria-label="Resize report panel" aria-controls=<panelId>`, `tabIndex={0}`. The value is the panel's share of the chat + panel area: `aria-valuenow` (rounded %, 58 by default, as in the mockup), `aria-valuemin` and `aria-valuemax` from the current clamp, and `aria-valuetext="Report panel, 58 percent"`.
- Keys follow the WAI-ARIA window splitter pattern, with the panel as the primary pane:
  - ArrowLeft and ArrowRight move the separator that way by 2 % (the panel grows or shrinks), Shift by 10 %;
  - Home sets the panel to its minimum, End to its maximum.
- Pointer: `pointerdown` sets pointer capture, and `pointermove` computes the fraction from the pane's left edge. During the drag, every iframe in the pane gets `pointer-events: none` (otherwise the iframe swallows the moves) and the body gets `user-select: none` and `cursor: col-resize`. `pointerup` commits.
- Double-click resets to 58 %.
- Writes to `oa.reportPanel` only on commit (pointerup, or a key press), so a drag doesn't write 60 times a second.
- A visible focus ring on the grip; the hit area is the full 12 px strip and the pane's height.

`reportPanelPref`: `read()` returns a number in (0, 1), or 0.58 when the value is missing, isn't a number or is out of range, or when `localStorage` throws. `write(f)` stores `f.toFixed(3)` in try/catch. `panelWidth.ts`: `clampPanel(fraction, available)`, `fractionLimits(available)`, `step(fraction, key, shift, limits)`. All pure, all unit-tested.

### `ReportCard` and `ReportThumb`

`ReportCard` `{ idPrefix; toolCallId; title; result: string | undefined; pressed: boolean; hint: "right" | "tap"; onOpen(reportId: string): void }`.

- Root id `widgetId("artifact-card", toolCallId, idPrefix)` (the id the persistence fix's E2E asserts), with `-title`, `-hint`, `-thumb`, `-thumb-img`, `-thumb-fallback`, `-icon`.
- Pending (`result === undefined`): `-pending`, `role="status"`. Error (no artifact id in the result): `-error`.
- `ReportThumb` `{ id; reportId; tall: boolean }` renders `<img src="/api/artifacts/<id>?format=thumb" alt="" loading="lazy" decoding="async" width="1200" height="480">`. On `error` it swaps in the placeholder tile and never retries in a loop.

### `ChatSession` and `TurnView`

- `reportsIn(turns): ReportRef[]` (`{ reportId, toolCallId, title }`) lists every artifact item with a parsed id, in chat order. Pending and failed items are left out. `ChatSession` calls `onReports` when the joined ids change.
- `agent.subscribe` gains `onToolCallStartEvent` (remembers `toolCallId → toolName` in a ref) and `onToolCallResultEvent`. For a `create_artifact` or `research` result whose content parses to an artifact id, it calls `onReportReady({ reportId, toolCallId, title })`. History set with `setMessages` produces no events, so a reopened or reloaded chat never reaches this path.
- `TurnView` renders `ReportCard` for artifact items, with `pressed = item's id === openReportId`.

## Routing

### URL

| URL | Panel |
| --- | --- |
| `/chats/<chatId>` | Closed, or the chat's remembered report on desktop (see arrival rules) |
| `/chats/<chatId>?report=<artifactId>` | That report, if it belongs to this chat |
| `/?report=…` | Dropped by the parser: a draft has no reports yet |

`shared/routes.ts`:

```ts
| { section: "chat"; chatId: string | null; report: string | null }
```

- `parseRoute`: for `/chats/<id>`, `report = ARTIFACT_ID_RE.test(q) ? q : null`. For `/` it is always `null`.
- `hrefFor`: `/chats/<id>` plus `?report=<id>` when set.
- `safeNext` needs no code change. It already rebuilds the URL with `hrefFor(parseRoute(…))`, so `/chats/<uuid>?report=<12 chars>` survives sign-in, a bad `report` is dropped, and the open-redirect guarantee holds (the output is built by the parser).
- `ChatHost` switches to `useRoute()`. The pane-opening effect still depends only on `chatId`, so a `?report` change never re-dispatches `open`.
- `chatHrefOf` (the rail's Chats link) adds the active chat's open report, so Reports → Chats comes back to the same panel. Chat list rows keep linking to `/chats/<id>`.

### History

- **Open or swap, desktop and tablet:** `history.replaceState(null, "", href)`. A panel is like the shell's other overlays, which add no history entries.
- **Open, phone:** `history.pushState({ oaReport: reportId }, "", href)`, and `panels[id].pushed = true`.
- **Close:** if `history.state?.oaReport === reportId`, call `history.back()`. The `popstate` then closes the panel through `useReportUrl`, so the back arrow and the browser's Back do the same thing. Otherwise call `replaceState` to the URL without the param and dispatch `closeReport`.
- A phone viewer opened from the URL (a reload, or a link) has no pushed entry. Its back arrow replaces, and the browser's Back leaves the chat. That is correct, since the user arrived on the viewer.

### `useReportUrl` (in `ChatHost`)

It compares the current `(chatId, report, visible)` with the previous one:

1. Not visible, or `chatId === null`: nothing.
2. **Arrival** (the chat id changed, or the chat just became visible):
   - with `report` in the URL: `openReport(how: "url")`;
   - without it, when the chat has a remembered panel: on desktop, `replaceState` to add the param (the URL mirrors the restored panel); on tablet and phone, `closeReport` (arriving never opens a modal).
3. **Same chat, `report` changed** (Back or Forward, a link): the URL wins. It opens with `how: "url"` or closes.
4. UI actions write the URL themselves through `report.open`/`report.close`. Step 3 then sees the URL already agreeing with the state and does nothing.

A `url`-opened panel never moves focus. On a reload the composer gets focus as it does today.

## Auto-open rules

`shouldAutoOpen(input)` in `lib/shell/autoOpen.ts` is pure and table-tested. It returns `true` only when all of these hold:

| Condition | Why |
| --- | --- |
| The event is a live `TOOL_CALL_RESULT` for `create_artifact` or `research` with an artifact id | "A report finishes during a live run". History never emits it. |
| The pane is the active one and the chat route is visible | "In the chat the user is currently viewing". A report finishing in a hidden running pane, or while the user is on `/reports`, doesn't open anything when they come back. |
| The breakpoint is desktop | The inline panel is the only non-modal placement. Tablet and phone viewers are modal and must take focus, which the composer rule forbids. |
| `shell.overlay === "none"` | Never open under the account menu, profile drawer, models panel or sidebar overlay. |
| `!runFlags.dismissed` | The user closed the panel during this run: respect it. |
| `!(runFlags.picked && a panel is open)` | The user picked a report by hand during this run and is reading it: don't swap it out. The new card appears, and the header's "n of m" and Next update. |

When it returns true: `report.open(threadId, reportId, "auto")`, which replaces the URL. Focus doesn't move, and the status line says "Opened “<title>” on the right." Otherwise, if the pane is active and visible, the status line says "Report ready: “<title>”."

**Focus guard.** A report's own script runs inside the sandboxed frame and could call `focus()`. When the panel was opened without the user (`how` is `auto` or `url`, or a restore on arrival) and the composer had focus, `ReportPanel` watches for 3 s after the frame's `load`. If `document.activeElement` becomes the frame with no `pointerdown` or `keydown` in the panel since the open, it puts focus back on the composer (`composerInputId(threadId)`). This is a guard on top of the browser's own limits on focus from opaque-origin frames, and the E2E checks it (see "Claims to verify").

## Focus and keyboard

| Event | Focus |
| --- | --- |
| Card click or Enter/Space (any breakpoint) | The panel's title (`<id>-title`) |
| Previous / Next | Stays on the button (`aria-disabled` at the ends, so it never becomes `disabled` under focus) |
| Close, Escape, backdrop, back arrow, Back that closes | The card of the report that was shown, in this pane (`#<pane>-artifact-card-<toolCallId>`). If there is none (a `url`-opened report from another turn list, a missing report), the composer. |
| Auto-open, URL open, restore on arrival | Unchanged |
| A resize into tablet or phone with the panel open | The panel's title |

Escape closes the panel on tablet and phone from anywhere. On desktop it closes it while focus is inside the panel's header or body (but not inside the iframe, whose keys the page can't see). Escape in the composer does nothing new. Tab order on desktop is chat column, separator, panel. The panel is a landmark (`aside`), so screen reader users can jump to it.

## Sidebar while the panel is inline

- `sidebar.inline = breakpoint === "desktop" && sidebar.open && !report.inline`, and `ShellFrame` passes it to `Sidebar` and to the rail's `showNewChat`.
- The pref `oa.sidebar` is never written by the panel. Closing the panel restores the inline sidebar exactly when the user had it open, as the brief asks.
- While `report.inline`, the rail toggle calls `open("sidebar")`. `ShellOverlays` renders the sidebar overlay on desktop in that case, the same overlay the tablet uses (focus trap, Escape, backdrop, closes on navigation). Its `aria-expanded` follows the overlay. **Builder's call:** an inline sidebar would squeeze the chat below 360 px at 1024–1140 px, and an overlay behaves the same at every width.
- On `/reports`, `/plans` and `/search` the chat is hidden, so `report.inline` is false and the inline sidebar is back. Returning to the chat collapses it again.

## Data and API changes

### Migration `<version>_artifact_thumbnails.sql`

```sql
alter table public.artifacts
  add column thumb_path text,
  add constraint artifacts_thumb_path_check
    check (thumb_path is null or thumb_path = user_id::text || '/' || id || '.jpg');

update storage.buckets
   set allowed_mime_types = array['text/html', 'application/pdf', 'image/jpeg']
 where id = 'artifacts';
```

Apply it with the MCP after `20261102000000_chat_message_parts`, rename the file to the applied version, regenerate `database.types.ts`, and run `get_advisors` (security and performance). RLS and grants are unchanged: `artifacts` stays service-role only, and no policy is added to the bucket.

### Agent

- `ArtifactFile = "html" | "pdf" | "jpg"`; `CONTENT_TYPE.jpg = "image/jpeg"`; upload uses `upsert` for `pdf` and `jpg`.
- `ArtifactRow` gains `thumbReady` (`!!thumb_path`), and `get` selects `thumb_path`. New `ArtifactRepo.setThumb(id)`, filtered by `id` and `user_id` like `setPdf`.
- `GET /artifacts/<id>.jpg` in `http/artifacts.ts`: `owner = deps.repos(user.id)`, then `artifacts.thumbnail(owner, id)`. It returns `image/jpeg` with `private, no-store` and `nosniff`, or 404 `not_found`. The id must match `ARTIFACT_ID_RE` after the suffix is stripped, as for `.pdf`.
- **Rate limits** (`lib/rateLimit.ts`):
  - `artifacts: { max: 600, windowMs: 10 min }`, taken on every `/artifacts/*` request. Opening a chat with many cards costs one per card;
  - `renders: { max: 40, windowMs: 10 min }`, taken only when a PDF or thumbnail isn't cached and a request (not the eager save path) has to render it. A cached read never counts;
  - both answer `429 rate_limited` with `retryAfter`, through the existing `rateLimitError`.
- **Fair rendering:** a per-user limiter (one render at a time per user, queued) in front of the global `RENDER_SLOTS = 2`. One user's backfill of old thumbnails can then hold at most one of the two Chromium slots.
- `ReportSummary` is unchanged. The card doesn't need `thumbReady`: a missing thumbnail is rendered on request, and the grid doesn't show thumbnails in this build.

### Web

- `GET /api/artifacts/[id]?format=thumb` → `/artifacts/<id>.jpg`. The response is `image/jpeg` with the `PRIVATE` headers; 401, 403, 404 and 429 pass through, anything else becomes 502. `reportThumbHref(id)` in `lib/reports.ts`.
- **Error pages for frames.** When the HTML request is a frame or document navigation (`sec-fetch-dest` is `iframe` or `document`) and the agent answers with an error, the route returns a minimal static HTML page (no scripts, `ARTIFACT_CSP`) with the same status instead of JSON:
  - 404: "This report doesn't exist or isn't yours.";
  - 429: "Too many requests. Try again in N seconds.";
  - anything else: "This report couldn't be loaded.", with a `target="_self"` link to the same URL labelled "Try again".

  Today a failing iframe shows raw JSON.
- No endpoint lists a chat's reports. The panel's list is `reportsIn(turns)`, which the persistence fix makes complete after a reload. A server list would duplicate it and could disagree with the cards on screen. Ownership is still checked on the server for every report the panel loads (`GET /api/reports/:id`, then `/api/artifacts/:id`, both scoped by the verified user).

## Edge cases

| Case | Behaviour |
| --- | --- |
| Report deleted, or the id isn't the user's | The panel shows "This report doesn't exist or isn't yours." with Close; the URL keeps the param until closed, so a reload shows the same honest state. The card's thumbnail falls back to the placeholder, and the card stays (it is the chat's history). |
| `?report=` names a report from another chat | "This report is from another chat." with "Open it in Reports". No n of m, no previous/next. |
| Report still being written | The pending card (`role="status"`, not clickable). If the panel is open on another report, its "n of m" counts only finished reports and updates when this one finishes. Auto-open follows the rules above. |
| Metadata fails (network, 5xx) | Error state with Retry inside the panel; header controls work. |
| The HTML fails after the metadata succeeded | The frame shows the static error page with "Try again". |
| Thumbnail fails or is rate limited | Placeholder tile, no retry loop. |
| PDF render slow or failing | The link downloads when the render is done (the first PDF takes a few seconds, later ones are cached). A failure answers with the existing JSON error as a download the browser reports as failed. That is unchanged behaviour, recorded here so nobody mistakes it for new. |
| Window at exactly 1024 px | Chat 360–576 px, panel 380–584 px. Below 1024 the tablet overlay takes over, which never squeezes the chat. |
| A narrow phone (320 px) | The viewer header fits: back 44 + title (truncates) + 2×44 + 8 px gaps. No horizontal scroll (checked at 390 in the E2E, and by the layout's `min-w-0` at 320). |
| Short desktop window (e.g. 1280×600) | The panel body scrolls inside the iframe; the header stays. |
| Two or three panes mounted, each with a panel | Each pane has its own panel element, ids under its own `chat-pane-<thread>-` prefix, and its own `panels` entry. Only the active pane's panel is visible, and only it can be modal. A report finishing in a hidden running pane doesn't open anything, and its card is there when the user comes back. At most three report iframes stay loaded. |
| Switching between two mounted chats | Each keeps its panel and iframe (no reload). The URL follows the active chat (`useReportUrl` arrival rule). |
| Returning to a chat whose pane unmounted | Desktop restores its panel from `panels`, and the iframe loads again (the pane is new). Tablet and phone don't. |
| A report opened, then the user goes to Reports and back | ChatHost and the pane are hidden, not unmounted, so the iframe isn't reloaded and keeps its scroll position. |
| Resize across 1024 or 768 with the panel open | The same panel element changes placement; the iframe isn't reloaded; modal placements take focus to the title. |
| The user drags the separator while a report finishes | Auto-open only changes which report is shown; the drag continues. |
| `localStorage` throws or holds garbage | Width 58 %, and nothing is written; the panel works. |
| Signed out while viewing | The existing auth handling (`readApi` → `authState`) shows the signed-out banner; the iframe's next request gets the static 401 page. |

## Security

- The frame keeps `sandbox={ARTIFACT_SANDBOX}` (no `allow-same-origin`), and the HTML keeps `ARTIFACT_CSP` with its own `sandbox` directive. `X-Frame-Options` stays exempt only for `/api/artifacts/`. Nothing in the panel loosens these.
- Every link the panel adds is same-origin and built from a validated id (`/api/artifacts/<id>`, `?format=pdf`). Model-written text (titles) renders as React text inside `<bdi>`. The report's own links are inside the sandbox, opened by its `<base target="_blank">`, as today.
- `?report=` passes `ARTIFACT_ID_RE` in `parseRoute` before any use. The web route checks it again, and the agent filters by the verified user's id on the row and the Storage path (`<user>/<id>.jpg`).
- The thumbnail render uses the PDF's guard (`blockInternalRequests`) and limits (20 s, render slots), plus the new per-user slot and `renders` limit. The image is served as `image/jpeg` with `nosniff` and `private, no-store`.
- New rate limits cover every artifact read, which had none.

## Visual language

| Mockup (dark) | Token |
| --- | --- |
| `#16171b` panel and phone viewer background | **new** `--panel`: dark `#16171b`, light `#f4f2ef`, exposed as `bg-panel` |
| `#1a1c21` card | `surface` |
| `#2c2f36` icon tiles | `paper` |
| `#23262d` separator rule, header rule | `surface-accent` |
| `#383b42` grip, Download PDF border | `border` |
| `#7fa6ac` pressed card border and ring | the `mist` accent used for focus rings |
| `#8f9094` position line, disabled arrows | `text-faint` (now `#9a9b9f` in dark after the shell build's contrast fix) |

The report itself keeps its own white page inside the frame. Light theme: the pressed ring uses the light `mist` value, and axe checks the position line and the hint text on `--panel` and `surface`. Under `prefers-reduced-motion` there is no slide for the overlay or the viewer (extend the existing block).

## Accessibility

- The card is a real `button` with `aria-pressed`. The thumbnail is decorative. The name includes the visible title (label-in-name).
- Desktop panel: `aside aria-label="Report"`; its title is a heading. Tablet and phone: `role="dialog" aria-modal="true" aria-labelledby`, focus moved in, Tab trapped, Escape closes, focus returned, everything outside `inert`.
- Separator: `role="separator"`, value, min, max and text, arrows, Shift+arrows, Home and End, visible focus.
- Previous and Next use `aria-disabled` at the ends, not `disabled`.
- The position line is text ("Report · 1 of 2 in this chat"), uppercased by CSS, so screen readers read it normally.
- One polite status line per pane for "Report ready" and "Opened … on the right". It sits in the pane, so hidden panes (which are `inert`) never announce.
- Touch targets are 44 px on phones (viewer header, card).
- Contrast: axe `color-contrast` in the E2E on the panel, the card (pressed and not) and the phone viewer, in both themes.

## Testing

Every new component test also asserts unique, non-empty ids (`test/support/ids.ts`).

### Web unit tests (vitest)

- `shared/routes` (agent runner): `/chats/<uuid>?report=<12 chars>` parses and round-trips through `hrefFor`. A bad `report` (11 or 13 characters, `..`, `%2f`) is dropped. `/?report=x` → `/`. `safeNext` keeps a valid `report`, drops a bad one, and still sends `//evil` and absolute URLs to `/`.
- `reportPanelPref.test.ts`: read and write; throwing `localStorage` → 0.58 and no throw; `"abc"`, `"0"`, `"1.5"` → 0.58.
- `panelWidth.test.ts`: `clampPanel` at 956, 1372 and 2400 px available; chat never under 360 and panel never under 380; arrows ±2 %, Shift ±10 %, Home and End to the limits; limits recomputed when the window shrinks.
- `reportRefs.test.ts`: `parseArtifactId` for both tools' result strings; `reportsIn` keeps chat order, skips pending and failed items, and handles `saved-<id>` tool call ids from backfilled history (via `toHistory` → `buildTurns`).
- `autoOpen.test.ts`: the table above, one row per condition, plus all true → open.
- `chatController.test.ts`: `openReport` and `closeReport`; `runFlags` set only while running and reset by a new run; `panels` survive `prune` of an idle thread and cap at 20.

### Component tests (Testing Library, CopilotKit mocked as in `chatHost.test.tsx`)

- `ReportCard`: thumbnail `src`, `alt=""`, fallback on `error` (no second request); label "Open report: <title>"; `aria-pressed` follows the open report; the hint text per breakpoint; pending variant (`role="status"`, no button) and error variant; root id and `-title` match `widgetId("artifact-card", …)`.
- `ReportPanel` and `ReportViewer` (desktop, `matchMedia` at 1440):
  - a card click opens the panel with focus on its title;
  - "Report · 1 of 2 in this chat"; Previous is `aria-disabled` on the first report; Next swaps and presses the second card;
  - the Download `href` and `download`, and the new tab `href`, `target` and `rel`;
  - Close returns focus to the card;
  - loading, missing, other-chat and error with Retry; the iframe isn't rendered before the metadata and keeps the `sandbox` attribute.
- `PanelSeparator`: role and ARIA values; arrows, Shift, Home and End change `aria-valuenow` and write `oa.reportPanel` once per key; a pointer drag sets `pointer-events: none` on the pane's iframes and clears it on `pointerup`, writing once; double-click resets; `localStorage` throwing doesn't break it.
- `ShellFrame` and `Rail`: the inline sidebar is hidden while the panel is shown and comes back on close; with `oa.sidebar = "collapsed"` it stays collapsed after close; `oa.sidebar` is never written by the panel; the rail toggle opens the sidebar overlay while the panel is inline; the rail shows New chat; `chatHrefOf` includes `?report=`.
- Tablet (800 px): the panel is a modal dialog; focus moves to the title; Tab and Shift+Tab stay inside; the rail and the chat column are `inert`; Escape and a backdrop click close it and return focus to the card; `inert` is removed exactly where it was added.
- Phone (390 px): a full-screen dialog with Back, Download and new tab and no previous/next; opening pushes `{ oaReport }`; the back arrow calls `history.back()`; a `popstate` to the URL without the param closes it and returns focus to the card; a viewer opened from the URL replaces on close.
- Iframe continuity (a ref callback counts iframe mounts): switching between two mounted panes, a trip to `/reports` and back, and crossing 1024 and 768 px each keep one mount.
- Auto-open (a mocked agent that emits `TOOL_CALL_START` and `TOOL_CALL_RESULT`):
  - desktop, active and visible pane: opens, the URL is replaced, focus stays in the composer, and the status line reads "Opened … on the right";
  - a hidden running pane: no open, and no open when it becomes active;
  - tablet and phone: no open, status "Report ready";
  - with the profile drawer open: no open;
  - after the user closed the panel in this run: no open;
  - after the user picked a report in this run: no swap;
  - a pane mounted with history containing reports: no open;
  - the focus guard returns focus to the composer when the frame takes it without user input after an `auto` or `url` open, and leaves it alone after a `pointerdown` in the panel.
- URL sync: open and swap on desktop leave `history.length` unchanged; arriving at a chat with a remembered panel on desktop adds the param by replace; on phone the same arrival closes it; Back from `?report=A` to `?report=B` in the same chat swaps.
- Two panes, each with a panel: no duplicate ids; each composer label still points at its own input.
- `ReportDetail` uses `ReportViewer`: today's ids and states still pass; "From:" links to `/chats/<id>?report=<id>` on desktop and without the param on phone; Open in a new tab is present.
- `test/api/routes.test.ts`: `format=thumb` → agent path `/artifacts/<id>.jpg` and `image/jpeg`; a bad id → 404 without calling the agent; an upstream 404 with `sec-fetch-dest: iframe` → an HTML page with `ARTIFACT_CSP` and no `<script>`; without that header → JSON as today.

### Agent tests (vitest)

- `artifacts/store.test.ts` (renderer stubbed):
  - `thumbnail` renders once, uploads `jpg`, sets `thumb_path`, and serves the cache after that; concurrent calls share one render;
  - a 600 KB image isn't stored;
  - `save` starts the eager render without awaiting it, a failing eager render is logged and `save` still returns the id;
  - the per-user slot keeps a second render for the same user waiting while another user's render runs.
- `http/artifacts.test.ts`: `.jpg` 200 with headers; 404 for another user's id and a bad id; `artifacts` limit → 429 after 600; `renders` limit counts only uncached renders (a cached PDF read after 40 renders still works).
- `test/fixtures/memoryRepos.ts`: `setThumb`, `thumbReady`, and `jpg` storage.

### Integration against Supabase (`npm run test:supabase`)

- `repos.int.test.ts`: `setThumb` writes the path that passes the check constraint, and another user's id is a no-op; a `jpg` upload to the bucket succeeds (allowed MIME type) and downloads back.
- `rls.int.test.ts`: `artifacts` still has no grants for `anon` or `authenticated`.

### End-to-end demo (`e2e/app-shell.demo.spec.ts`)

Seed (`e2e/support/seed.ts`): the second seeded report (`e2eReport002`) moves to the Big Sur chat. Its `create_artifact` part is added after `BIG_SUR_REPORT`'s on the same reply (`call-e2eReport002`). `SEED.reports` stays 13. Both reports have no thumbnail, so the lazy render path runs. `e2eReport002`'s HTML gets an inline script that tries to take focus on load (see "Claims to verify", 2).

Step 6 changes: on desktop, "From:" now lands on `/chats/<bigSur>?report=e2eReport001`, so its URL assertion gains the query. The persistence fix's card check and reload stay.

New desktop step **6b. "The report panel: open, swap, resize, reload, close"**, right after step 6:

1. The panel is open from the "From:" link: `#chat-pane-<bigSur>-report-panel-position` reads "Report · 1 of 2 in this chat" (case-insensitive); the inline sidebar is gone and the rail shows New chat; card 1 has `aria-pressed="true"`; the iframe has the `sandbox` attribute.
2. Each card's thumbnail loads (`naturalWidth > 0`).
3. Next → "2 of 2", card 2 pressed, URL `?report=e2eReport002`, `history.length` unchanged.
4. Separator: focus it, ArrowLeft three times → `aria-valuenow` +6; End → max; Home → min; mouse-drag the grip to about 50 %.
5. **Reload:** the panel is open on report 2 at the same width (URL and `localStorage`), and focus is in the composer.
6. Mark the iframe node (`data-e2e-mark`), record requests to `/api/artifacts/`, go to Reports with the rail and back with the rail's Chats: same node, zero new artifact requests, URL still has `?report=`.
7. Close: focus on card 2, the inline sidebar is back, no `?report=`.
8. **No auto-open on reopen or reload:** reload → panel closed; open the chat from the sidebar → panel closed.
9. **Live auto-open:** with focus in the composer, send "Make a one-page printable packing list for this weekend as a report." Wait (up to 300 s) for a third card. The panel opens on its own on "3 of 3", the URL has the new id, and `document.activeElement` is still the composer input. If the model answers without a report, the step fails with an explicit message rather than passing silently.
10. axe `color-contrast` on the panel and the cards, in light and dark.

Tablet test, new step **12b. "The report overlay"**: open the Big Sur chat, tap card 1 → a dialog with focus on its title; Tab cycles inside; Escape closes it and focus is back on the card; open `?report=e2eReport001` directly → the overlay is open after load.

Phone test, new step **13b. "The full-screen report viewer"**:

- tap card 1 → the viewer covers the tabs, and the URL gains `?report=` (a pushed entry);
- the back arrow closes it and the URL loses the param;
- tap again, then `page.goBack()` → closed and still on the chat;
- the Download link's `href` has `format=pdf`;
- no horizontal scroll with the viewer open;
- axe contrast in both themes.

`scripts/make-demo.mjs` needs no change: it joins clips per project.

## Build order and commits

Owner rules apply: a commit after each major step; `npm run build`, lint, format check, typecheck and tests in `agent` and `web` before each commit; rebuild and restart the containers after each major change; self-review each diff; never commit `.env*`, keys or `.mcp.json`.

1. Migration (apply with the MCP, rename, advisors), regenerated types, repo and storage changes, `ArtifactStore.thumbnail`, eager render, per-user render slot, `.jpg` route, rate limits, agent and integration tests.
2. Web API route (`format=thumb`, error pages), `shared/routes.ts` `report`, `safeNext` tests.
3. `chatController` panels and run flags, `ShellProvider` report API and derived sidebar, `reportPanelPref`, `panelWidth`, `inertOutside`, `autoOpen`, `reportRefs`, unit tests.
4. `ReportViewer`, `ReportPanel`, `PanelSeparator`, `ReportCard`, `ReportThumb`; `ChatPane`, `ChatSession`, `TurnView`, `ChatHost` with `useReportUrl`; `ShellFrame`, `ShellOverlays`, `Rail`; delete `ArtifactCard` and `ArtifactViewer`; `ReportDetail` on `ReportViewer`; `--panel` token; component tests.
5. E2E seed and steps 6b, 12b and 13b, demo run, README line under "Workspace and chats" (reports open beside the chat).

## Builder's calls in this spec (summary)

- Auto-open on desktop only; tablet and phone announce instead.
- A stored JPEG thumbnail, rendered eagerly after save with a lazy fallback; 800×320 at 1.5×, quality 70, 512 KB cap.
- Per-chat panel memory for the page session; desktop restores on arrival, tablet and phone don't.
- Replace on desktop and tablet, push on phone; close goes back only over an entry the viewer pushed.
- The sidebar opens as an overlay while a panel is inline.
- Widths: chat ≥ 360, panel ≥ 380, default 58 %, 2 % and 10 % key steps; the value is the panel's share.
- Panel header height 64 px to match `ChatHeader`.
- `--panel` light value `#f4f2ef`.
- The pressed card does nothing on a second click (Close is in the panel).
- "From:" on the report page opens the chat with the report on the right, on desktop.
- A report from another chat is refused in a chat's panel, with a link to Reports.
- Static HTML error pages for frame navigations.
- Rate limits: `artifacts` 600 and `renders` 40 per 10 minutes, one render at a time per user.

## Claims to verify during build

1. **An iframe in a `hidden` (display: none) and `inert` subtree keeps its document**, and showing it again doesn't reload it. Proof: E2E 6b.6 (same node, zero requests).
2. **A report's script can't take focus from the composer** (opaque-origin frame, no user activation), and if it can, the focus guard puts it back. Proof: the seeded `e2eReport002` carries a script that calls `window.focus()` and focuses a `tabindex` element on load; E2E 6b.5 (reload with `?report=e2eReport002`) and 6b.9 (live auto-open) both check that `document.activeElement` is the composer input.
3. **The thumbnail viewport shows the desktop report layout** at 800 px, and the 2.5:1 crop reads well at 320×128 and on phones at 358×150. Proof: look at the seeded and live thumbnails in the demo video; adjust the viewport if needed and note it in Build notes.
4. **`pointer-events: none` on the iframes during a drag** keeps `pointermove` flowing to the separator in Chromium, WebKit and Firefox. Proof: the E2E drag in 6b.4 (Chromium); manual check in Safari.
5. **`inertOutside` plus `aria-modal`** leaves VoiceOver and NVDA unable to reach the chat behind the tablet overlay. Proof: manual check, recorded in Build notes.
6. **The migration applies as written** (the bucket update in particular) and advisors show nothing new. Proof: MCP apply, `get_advisors`, the integration upload test.

## Open questions for the owner

1. The approved `ReportPanel` mockup shows the composer placeholder "Ask about this report…" while a report is open. That promises the agent knows which report is on screen, which it doesn't today: the run gets no report context, and after a reload its history holds only the report's title. This build keeps the normal placeholder. The follow-up would be to send `{ openReport: { id } }` in the pane's `user_context` (validated by the agent against the user's artifacts) and give the agent a read-only tool to load that report's text, then switch the placeholder. Should that be the next piece of work?

## Build notes

Empty until the build. Record outcomes of "Claims to verify", deviations and review fixes here, as the app shell spec does.
