import { expect, type Page, test } from "@playwright/test";
import { expectContrast, expectNoHorizontalScroll } from "./support/a11y";
import { mockReportRun } from "./support/reportRun";
import { BIG_SUR, BIG_SUR_REPORT, LIVE_REPORT, SECOND_REPORT, SEED, TRIP_ID } from "./support/seed";
import { seeded } from "./support/state";

function entityKey(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

const composer = (page: Page) => page.locator("main [id$='-composer-input']:visible");
const setTheme = async (page: Page, dark: boolean) => {
  await page.locator("#account-menu-button").click();
  const item = page.locator("#account-menu-theme");
  if ((await item.getAttribute("aria-checked")) !== String(dark)) await item.click();
  await page.keyboard.press("Escape");
};

const REPORT_PLACEHOLDER = "Ask about this report…";
const thumbLoaded = (page: Page, sel: string) =>
  page.locator(sel).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0).catch(() => false);
const historyLength = (page: Page) => page.evaluate(() => window.history.length);

test.describe.configure({ mode: "serial" });

test("desktop: first run, sidebar, chats, search, reports, plans, account and resize @desktop", async ({ page }) => {
  const s = seeded();
  let chatCount: number = SEED.chats;

  await test.step("1. Meet your agent: name, look and tone", async () => {
    await page.goto("/");
    const step = page.locator("#onboarding-step");
    await expect(step).toContainText("01 /");
    await expect(step).toContainText("Your agent");
    expect(["01 / 06 · YOUR AGENT", "01 / 07 · YOUR AGENT"]).toContain((await step.innerText()).toUpperCase());
    await page.locator("#agent-section-onboarding-name-input").fill("Sage");
    await page.locator("#agent-section-onboarding-look-ember").click();
    await page.locator("#agent-section-onboarding-tone-brief").click();
    await expect(page.locator("#agent-section-onboarding-title")).toHaveText("Hi, I'm Sage.");
    await page.locator("#onboarding-next").click();
    for (let i = 0; i < 6; i++) {
      const title = await page.locator("#onboarding-step").innerText();
      if (/model/i.test(title)) await page.getByRole("radio", { name: /DeepSeek V4 Flash/ }).click();
      if (/all set/i.test(title)) break;
      await page.locator("#onboarding-next").click();
    }
    await expect(page.locator("#onboarding-summary")).toContainText("Sage · brief · ember look");
    await page.locator("#onboarding-next").click();
    await expect(page.locator("#rail")).toBeVisible();
  });

  await test.step("2. The rail, the sidebar and the agent card", async () => {
    await expect(page.locator("#rail")).toHaveAttribute("aria-label", "Main");
    const sidebar = page.locator("#sidebar");
    await expect(sidebar).toBeVisible();
    for (const group of ["Today", "This week", "Earlier"]) await expect(sidebar.getByRole("heading", { name: group, exact: true })).toBeVisible();
    await expect(page.locator("#chat-list-sidebar-count")).toHaveText(`Showing 20 of ${chatCount}`);
    await page.locator("#chat-list-sidebar-more").click();
    await expect(page.locator("#chat-list-sidebar-count")).toHaveText(`Showing ${chatCount} of ${chatCount}`);
    await expect(page.locator("#agent-card-name")).toHaveText("Sage");
    await expect(page.locator("#agent-card-knows")).toContainText("Your agent ·");
    await expect(composer(page)).toHaveAttribute("placeholder", /Ask ⁨Sage⁩ to research, compare, or plan…/);
  });

  await test.step("3. Open a chat; a reply keeps running while you look elsewhere", async () => {
    await page.locator(`#chat-list-sidebar-row-${s.bigSur}`).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${s.bigSur}$`));
    await expect(page.locator(`#chat-list-sidebar-row-${s.bigSur}`)).toHaveAttribute("aria-current", "page");
    await expect(page.locator(`#chat-pane-${s.bigSur}-header-title`)).toHaveText(BIG_SUR);
    const pane = page.locator(`#chat-pane-${s.bigSur}`);
    await pane.evaluate((el) => el.setAttribute("data-e2e-mark", "same-pane"));
    await composer(page).fill("Give me one more vegetarian dinner idea near Big Sur, in one sentence.");
    await composer(page).press("Enter");
    await expect(page.locator(`#chat-pane-${s.bigSur}-header-status`)).toContainText("Sage is working on this");
    await page.locator("#rail-reports").click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.locator("#rail-chats-dot")).toBeVisible();
    await page.locator("#rail-chats").click();
    await expect(page).toHaveURL(new RegExp(`/chats/${s.bigSur}$`));
    await expect(pane).toHaveAttribute("data-e2e-mark", "same-pane");
    await expect(page.locator(`#chat-pane-${s.bigSur}-header-status`)).toBeHidden({ timeout: 180_000 });
    await expect(page.locator(`#chat-pane-${s.bigSur}-turns article`)).toHaveCount(2);
    await page.locator("#sidebar-new-chat").click();
    await expect(page).toHaveURL(/\/$/);
    const draft = page.locator("#chat-host > section:visible");
    await draft.evaluate((el) => el.setAttribute("data-e2e-mark", "draft-pane"));
    await composer(page).fill("Say hello in five words.");
    await composer(page).press("Enter");
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.locator("#chat-host > section:visible")).toHaveAttribute("data-e2e-mark", "draft-pane");
    chatCount += 1;
    await expect(page.locator("[id$='-header-status']:visible")).toBeHidden({ timeout: 180_000 });
  });

  await test.step("4. Collapse the sidebar; it stays collapsed; New chat shows the empty state", async () => {
    await page.locator("#rail-sidebar-toggle").click();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("#rail-new-chat")).toBeVisible();
    await page.reload();
    await expect(page.locator("#rail")).toBeVisible();
    await expect(page.locator("#sidebar")).toBeHidden();
    await page.locator("#rail-new-chat").click();
    await expect(page).toHaveURL(/\/$/);
    const empty = page.locator("main [id$='-empty']:visible");
    await expect(empty.locator("[id$='-empty-orb']")).toBeVisible();
    await expect(empty.getByRole("heading", { level: 1 })).toContainText("What should I look into?");
    await expect(empty.locator("[id$='-empty-suggestions'] li")).toHaveCount(4);
    await expect(page.locator("main [id$='-header']:visible")).toHaveCount(0);
    await page.locator("#rail-sidebar-toggle").click();
    await expect(page.locator("#sidebar")).toBeVisible();
  });

  await test.step("5. Search from the sidebar", async () => {
    const before = page.url();
    await page.locator("#sidebar-search-input").fill("mcway");
    await expect(page).toHaveURL(/\/search\?q=mcway$/);
    await expect(page.locator("#search-pager-range")).toHaveText("Showing 1–1 of 1");
    await expect(page.locator(`#search-hit-chat-${s.bigSur}-snippet mark`)).toHaveText("McWay");
    await page.goBack();
    await expect(page).toHaveURL(before);
    await page.locator("#rail-search").click();
    const field = page.locator("#search-field-input");
    await expect(field).toBeFocused();
    await field.pressSequentially("mcway", { delay: 60 });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("mcway");
    await expect(page).toHaveURL(/\/search\?q=mcway$/);
    await expect(page.locator(`#search-hit-chat-${s.bigSur}-snippet mark`)).toHaveText("McWay");
    await page.locator("#search-scopes-all").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#search-scopes-chats")).toBeFocused();
    await expect(page).toHaveURL(/\/search\?q=mcway&scope=chats$/);
    await expect(page.locator("#search-scopes-chats")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(page.locator("#search-scopes-reports")).toBeFocused();
    await expect(page).toHaveURL(/scope=reports$/);
    await page.keyboard.press("Home");
    await expect(page.locator("#search-scopes-all")).toBeFocused();
    await expect(page).toHaveURL(/\/search\?q=mcway$/);
    await page.goto(before);
  });

  await test.step("6. Reports: grid, paging, a report and its PDF", async () => {
    await page.locator("#rail-reports").click();
    await expect(page.locator("#reports-pager-range")).toHaveText(`Showing 1–12 of ${SEED.reports}`);
    await page.locator("#reports-pager-next").click();
    await expect(page).toHaveURL(/\/reports\?page=2$/);
    await expect(page.locator("#reports-pager-range")).toHaveText(`Showing 13–13 of ${SEED.reports}`);
    await page.locator("#reports-pager-prev").click();
    await page.locator(`#reports-row-${s.reports[0]}-open`).click();
    await expect(page.locator("#report-detail-frame")).toHaveAttribute("sandbox", /allow-scripts/);
    const download = page.waitForEvent("download");
    await page.locator("#report-detail-pdf").click();
    await download;
    await page.locator("#report-detail-from").click();
    await expect(page).toHaveURL(new RegExp(`/chats/${s.bigSur}\\?report=${BIG_SUR_REPORT.id}$`));
    const card = `#chat-pane-${s.bigSur}-artifact-card-${BIG_SUR_REPORT.toolCallId}`;
    await expect(page.locator(card)).toBeVisible();
    await page.reload();
    await expect(page.locator(`${card}-title`)).toHaveText(BIG_SUR_REPORT.title);
  });

  await test.step("6b. The report panel: open, swap, resize, reload, close", async () => {
    const pane = `#chat-pane-${s.bigSur}`;
    const panel = `${pane}-report-panel`;
    const card1 = `${pane}-artifact-card-${BIG_SUR_REPORT.toolCallId}`;
    const card2 = `${pane}-artifact-card-${SECOND_REPORT.toolCallId}`;
    const card3 = `${pane}-artifact-card-${LIVE_REPORT.toolCallId}`;
    const sep = page.locator(`${pane}-report-separator`);
    const input = page.locator(`${pane}-composer-input`);
    const now = async () => Number(await sep.getAttribute("aria-valuenow"));

    await expect(page.locator(`${panel}-position`)).toHaveText(/report · 1 of 2 in this chat/i);
    await expect(page.locator("#sidebar")).toHaveCount(0);
    await expect(page.locator("#rail-new-chat")).toBeVisible();
    await expect(page.locator(card1)).toHaveAttribute("aria-current", "true");
    await expect(page.locator(`${panel}-frame`)).toHaveAttribute("sandbox", /allow-scripts/);
    await expect(input).toHaveAttribute("placeholder", REPORT_PLACEHOLDER);

    for (const c of [card1, card2]) {
      await page.locator(c).scrollIntoViewIfNeeded();
      await expect.poll(() => thumbLoaded(page, `${c}-thumb-img`), { timeout: 60_000 }).toBe(true);
    }

    const length = await historyLength(page);
    await page.locator(`${panel}-next`).click();
    await expect(page.locator(`${panel}-position`)).toHaveText(/report · 2 of 2 in this chat/i);
    await expect(page.locator(card2)).toHaveAttribute("aria-current", "true");
    await expect(page).toHaveURL(new RegExp(`\\?report=${SECOND_REPORT.id}$`));
    expect(await historyLength(page)).toBe(length);

    await sep.focus();
    const start = await now();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    expect(await now()).toBe(start + 6);
    await page.keyboard.press("End");
    expect(await now()).toBe(Number(await sep.getAttribute("aria-valuemax")));
    await page.keyboard.press("Home");
    expect(await now()).toBe(Number(await sep.getAttribute("aria-valuemin")));
    const grip = await page.locator(`${pane}-report-separator-grip`).boundingBox();
    const area = await page.locator(pane).boundingBox();
    if (!grip || !area) throw new Error("no separator box");
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width / 2, grip.y + grip.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(now).toBeGreaterThanOrEqual(48);
    expect(await now()).toBeLessThanOrEqual(52);
    const width = await page.locator(panel).evaluate((el) => el.getBoundingClientRect().width);
    const stored = await page.evaluate(() => localStorage.getItem("oa.reportPanel"));

    await page.mouse.move(1, 1);
    await page.reload();
    await expect(page.locator(`${panel}-position`)).toHaveText(/report · 2 of 2 in this chat/i);
    await expect(page.locator(`${panel}-frame`)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("oa.reportPanel"))).toBe(stored);
    expect(Math.abs((await page.locator(panel).evaluate((el) => el.getBoundingClientRect().width)) - width)).toBeLessThanOrEqual(1);
    await page.waitForTimeout(6000);
    await expect(input).toBeFocused();
    await page.keyboard.type("still mine");
    await expect(input).toHaveValue("still mine");
    await input.fill("");

    const frame = page.locator(`${panel}-frame`);
    await frame.evaluate((el) => el.setAttribute("data-e2e-mark", "same-frame"));
    const requests: string[] = [];
    const onRequest = (r: { url(): string }) => {
      if (r.url().includes("/api/artifacts/")) requests.push(r.url());
    };
    page.on("request", onRequest);
    await page.locator("#rail-reports").click();
    await expect(page).toHaveURL(/\/reports$/);
    await page.locator("#rail-chats").click();
    await expect(page).toHaveURL(new RegExp(`/chats/${s.bigSur}\\?report=${SECOND_REPORT.id}$`));
    await expect(frame).toHaveAttribute("data-e2e-mark", "same-frame");
    page.off("request", onRequest);
    expect(requests).toEqual([]);

    await page.locator(`${panel}-close`).click();
    await expect(page.locator(card2)).toBeFocused();
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/chats/${s.bigSur}$`));
    await expect(input).not.toHaveAttribute("placeholder", REPORT_PLACEHOLDER);

    await page.reload();
    await expect(page.locator(card1)).toBeVisible();
    await expect(page.locator(panel)).toHaveCount(0);
    await page.locator(`#chat-list-sidebar-row-${s.chats[1].id}`).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${s.chats[1].id}$`));
    await page.locator(`#chat-list-sidebar-row-${s.bigSur}`).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${s.bigSur}$`));
    await expect(page.locator(panel)).toHaveCount(0);

    await page.locator(card1).click();
    await expect(page.locator(`${panel}-frame`)).toBeVisible();
    for (const dark of [false, true]) {
      await setTheme(page, dark);
      await page.waitForTimeout(400);
      await expectContrast(page, `report panel (${dark ? "dark" : "light"})`);
    }

    const run = await mockReportRun(page);
    const before = await historyLength(page);
    await input.focus();
    await input.fill("Make a packing list as a report.");
    await input.press("Enter");
    await expect(page.locator(`${panel}-position`)).toHaveText(/report · 3 of 3 in this chat/i, { timeout: 30_000 });
    const context = run.body()?.context ?? [];
    const open = context.find((c) => c.description === "open_report");
    expect(open?.value).toContain(BIG_SUR_REPORT.id);
    await expect(page.locator(card3)).toHaveAttribute("aria-current", "true");
    await expect(page).toHaveURL(new RegExp(`\\?report=${LIVE_REPORT.id}$`));
    expect(await historyLength(page)).toBe(before);
    await expect(page.locator(`${pane}-report-status`)).toHaveText(`Opened “${LIVE_REPORT.title}” on the right.`);
    await expect(input).toBeFocused();
    await page.waitForTimeout(1500);
    await expect(input).toBeFocused();
    await page.locator(`${panel}-close`).click();
    await expect(page).toHaveURL(new RegExp(`/chats/${s.bigSur}$`));
  });

  await test.step("7. Plans: counts, the trip filter and a read-only trip", async () => {
    await page.locator("#rail-plans").click();
    await expect(page.locator("#plans-filter-all")).toHaveText("All · 4");
    await expect(page.locator("#plans-filter-trip")).toHaveText("Trips · 1");
    await page.locator("#plans-filter-trip").click();
    await expect(page).toHaveURL(/\/plans\?kind=trip$/);
    const key = entityKey(TRIP_ID);
    await page.locator(`#plans-row-${s.tripChat}-trip-${key}-view`).click();
    await expect(page).toHaveURL(new RegExp(`/plans/${s.tripChat}/trip/${key}$`));
    await expect(page.locator("#plan-detail-header-title")).toHaveText("Big Sur");
    await expect(page.locator("#plan-detail-inner input:enabled")).toHaveCount(0);
    await page.locator("#plan-detail-open-chat").click();
    await expect(page).toHaveURL(new RegExp(`/chats/${s.tripChat}$`));
  });

  await test.step("8. Deep links, other people's chats and signed-out redirects", async () => {
    const extra = await page.context().newPage();
    await extra.goto(`/reports/${s.reports[1]}`);
    await expect(extra.locator("#report-detail-frame")).toBeVisible();
    await extra.goto(`/plans/${s.tripChat}/trip/${entityKey(TRIP_ID)}`);
    await expect(extra.locator("#plan-detail-header-title")).toHaveText("Big Sur");
    await extra.goto(`/chats/${s.otherChat}`);
    await expect(extra.locator(`#chat-pane-${s.otherChat}-missing-title`)).toHaveText("This chat doesn't exist or isn't yours.");
    await extra.goto(`/plans/${s.tripChat}/trip/..`);
    await expect(extra.locator("#shell-not-found-title")).toHaveText("This page doesn't exist.");
    await expect(extra.locator("#rail")).toBeVisible();
    await extra.close();
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser");
    const anon = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
    const out = await anon.newPage();
    await out.goto("/search?q=tacos");
    await expect(out).toHaveURL(/\/login\?next=%2Fsearch%3Fq%3Dtacos$/);
    await anon.close();
  });

  await test.step("9. Account menu: theme, contrast, and renaming the agent", async () => {
    await page.locator("#account-menu-button").click();
    const menu = page.locator("#account-menu-list");
    await expect(menu).toBeVisible();
    await page.waitForTimeout(500);
    const button = await page.locator("#account-menu-button").boundingBox();
    const box = await menu.boundingBox();
    expect(box && button && box.y + box.height <= button.y + button.height + 1).toBe(true);
    await page.keyboard.press("Escape");
    for (const dark of [false, true]) {
      await setTheme(page, dark);
      for (const path of ["/", "/search?q=big", "/reports", "/plans"]) {
        await page.goto(path);
        await page.locator("#shell-main").waitFor();
        await page.waitForTimeout(400);
        await expectContrast(page, `${path} (${dark ? "dark" : "light"})`);
      }
    }
    await page.locator("#account-menu-button").click();
    await page.locator("#account-menu-agent").click();
    await expect(page.locator("#agent-section-profile-name-input")).toBeFocused();
    await page.locator("#agent-section-profile-name-input").fill("Milo");
    await page.locator("#agent-section-profile-look-moss").click();
    await page.locator("#agent-section-profile-tone-thorough").click();
    await page.locator("#profile-save").click();
    await expect(page.locator("#profile-drawer")).toHaveCount(0);
    await expect(page.locator("#agent-card-name")).toHaveText("Milo");
    await page.locator("#rail-chats").click();
    await expect(composer(page)).toHaveAttribute("placeholder", /Milo/);
    await expect(page.locator("main [id$='-disclaimer']:visible")).toContainText("Read-only: Milo looks things up");
  });

  await test.step("10. Keyboard: the rail and the account menu", async () => {
    await page.locator("#rail-chats").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#rail-search")).toBeFocused();
    await page.locator("#account-menu-button").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#account-menu-profile")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#account-menu-agent")).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.locator("#account-menu-signout")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#account-menu-list")).toHaveCount(0);
    await expect(page.locator("#account-menu-button")).toBeFocused();
  });

  await test.step("11. Resize across the breakpoints keeps the chat and its text", async () => {
    await page.goto(`/chats/${s.bigSur}`);
    await composer(page).fill("Draft that must survive a resize");
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.locator("#sidebar")).toHaveCount(0);
    await expect(composer(page)).toHaveValue("Draft that must survive a resize");
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("#sidebar")).toBeVisible();
    await expect(composer(page)).toHaveValue("Draft that must survive a resize");
  });
});

test("tablet: rail plus an overlay sidebar @tablet", async ({ page }) => {
  await test.step("12. The sidebar opens over the page, traps focus and closes on Escape", async () => {
    await page.goto("/");
    await expect(page.locator("#rail")).toBeVisible();
    await expect(page.locator("#sidebar")).toHaveCount(0);
    await page.locator("#rail-sidebar-toggle").click();
    const panel = page.locator("#sidebar-overlay-panel");
    await expect(panel).toBeVisible();
    for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
    expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.locator("#rail-sidebar-toggle")).toBeFocused();
  });

  await test.step("12b. The report overlay", async () => {
    const s = seeded();
    const pane = `#chat-pane-${s.bigSur}`;
    const panel = page.locator(`${pane}-report-panel`);
    const card1 = page.locator(`${pane}-artifact-card-${BIG_SUR_REPORT.toolCallId}`);
    await page.goto(`/chats/${s.bigSur}`);
    await expect(card1).toContainText("Report · tap to read");
    await card1.click();
    await expect(panel).toHaveAttribute("role", "dialog");
    await expect(page.locator(`${pane}-report-panel-title`)).toBeFocused();
    await page.locator(`${pane}-report-panel-close`).focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(`${pane}-report-panel-frame`)).toBeFocused();
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(card1).toBeFocused();
    await page.goto(`/chats/${s.bigSur}?report=${BIG_SUR_REPORT.id}`);
    await expect(panel).toHaveAttribute("role", "dialog");
    await expect(page.locator(`${pane}-report-panel-frame`)).toBeVisible();
  });
});

test("phone: top bar, tabs, drawer and account sheet @phone", async ({ page }) => {
  await test.step("13. Phone chrome", async () => {
    await page.goto("/");
    await expect(page.locator("#mobile-topbar-name")).toHaveText("Milo");
    for (const [tab, path] of [
      ["#mobile-tabs-reports", /\/reports$/],
      ["#mobile-tabs-plans", /\/plans$/],
      ["#mobile-tabs-chat", /\/(chats\/[0-9a-f-]+)?$/],
    ] as const) {
      await page.locator(tab).click();
      await expect(page).toHaveURL(path);
      await expect(page.locator(tab)).toHaveAttribute("aria-current", "page");
      await expectNoHorizontalScroll(page, tab);
    }
    await page.locator("#mobile-topbar-menu").click();
    const drawer = page.locator("#mobile-drawer-panel");
    await expect(page.locator("#mobile-drawer-close")).toBeFocused();
    for (let i = 0; i < 30; i++) await page.keyboard.press("Tab");
    expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(page.locator("#mobile-topbar-menu")).toBeFocused();
    await page.locator("#mobile-topbar-menu").click();
    await page.locator("#chat-list-drawer-all").click();
    await expect(page).toHaveURL(/\/chats$/);
    await expectNoHorizontalScroll(page, "/chats");
    await page.locator("#mobile-topbar-menu").click();
    await page.locator("#mobile-drawer-search-input").fill("guide");
    await expect(page).toHaveURL(/\/search\?q=guide/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#search-results")).toBeVisible();
    await expectNoHorizontalScroll(page, "/search");
  });

  await test.step("13b. The full-screen report viewer", async () => {
    const s = seeded();
    const pane = `#chat-pane-${s.bigSur}`;
    const panel = page.locator(`${pane}-report-panel`);
    const card1 = page.locator(`${pane}-artifact-card-${BIG_SUR_REPORT.toolCallId}`);
    const chatUrl = new RegExp(`/chats/${s.bigSur}$`);
    await page.goto(`/chats/${s.bigSur}`);
    await card1.click();
    await expect(panel).toHaveAttribute("role", "dialog");
    await expect(page).toHaveURL(new RegExp(`\\?report=${BIG_SUR_REPORT.id}$`));
    const box = await panel.boundingBox();
    const tabs = await page.locator("#mobile-tabs").boundingBox();
    expect(box && tabs && box.y + box.height >= tabs.y + tabs.height).toBe(true);
    expect(await page.evaluate(() => {
      const tabs = document.getElementById("mobile-tabs")!.getBoundingClientRect();
      const top = document.elementFromPoint(tabs.x + tabs.width / 2, tabs.y + tabs.height / 2);
      return !!top?.closest("[id$='-report-panel']");
    })).toBe(true);
    await expect(page.locator(`${pane}-report-panel-pdf`)).toHaveAttribute("href", /format=pdf/);
    await expect(page.locator(`${pane}-report-panel-prev`)).toHaveCount(0);
    await expectNoHorizontalScroll(page, "report viewer");
    for (const dark of [false, true]) {
      await page.evaluate((d) => document.documentElement.classList.toggle("dark", d), dark);
      await page.waitForTimeout(300);
      await expectContrast(page, `report viewer (${dark ? "dark" : "light"})`);
    }
    await page.locator(`${pane}-report-panel-back`).click();
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(chatUrl);
    await card1.click();
    await expect(panel).toBeVisible();
    await page.goBack();
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(chatUrl);
    const length = await historyLength(page);
    await page.goForward();
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`\\?report=${BIG_SUR_REPORT.id}$`));
    await page.locator(`${pane}-report-panel-back`).click();
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(chatUrl);
    expect(await historyLength(page)).toBe(length);
    await page.goBack();
    await expect(page).not.toHaveURL(chatUrl);
    await page.goto(`/chats/${s.bigSur}`);
    await expect(card1).toBeVisible();
  });

  await test.step("14. Sign out from the account sheet", async () => {
    await page.locator("#mobile-tabs-you").click();
    await expect(page.locator("#account-sheet-panel")).toBeVisible();
    await page.locator("#account-sheet-signout").click();
    await expect(page).toHaveURL(/\/login/);
  });
});
