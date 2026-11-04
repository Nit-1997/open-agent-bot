import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const req = createRequire(join(REPO, "package.json"));
const { chromium } = req("playwright");
const { expect } = req("@playwright/test");

const APP = "http://localhost:18721";
const STUB = "http://127.0.0.1:18722/v1";
const DEMO_DIR = resolve(REPO, process.env.DEMO_DIR ?? ".factory/m7/demo");
const OUT = join(DEMO_DIR, "browser");
const TMP = join(OUT, "tmp");
const LIVE_HOST = /(^|\.)supabase\.co$|^api\.supabase\.com$/;
mkdirSync(TMP, { recursive: true });

const log = (m) => console.log(`[browser] ${m}`);
const users = (...a) =>
  execFileSync("node", [join(REPO, "scripts/demo/m7/users.mjs"), ...a], { encoding: "utf8", env: process.env }).trim();
const sql = (q) => {
  const out = users("sql", q);
  log(`sql: ${q} -> ${out}`);
  return JSON.parse(out);
};
const email = (tag) => `oab-m7+demo-${tag}@example.test`;
const used = (tag) => users("counts", tag);

const composer = (p) => p.locator("main [id$='-composer-input']:visible");
const stopBtn = (p) => p.locator("main [id$='-composer-stop']:visible");
const notice = (p) => p.locator("main [id$='-refusal'][role=status]:visible");
const redBanner = (p) => p.locator("main [id$='-error'][role=alert]:visible");
const meterCount = (p) => p.locator("#sidebar-usage-meter-count");

let shotN = 0;
let scenario = "";
async function shot(p, name) {
  shotN += 1;
  const file = join(OUT, `${scenario}-${String(shotN).padStart(2, "0")}-${name}.png`);
  await p.screenshot({ path: file });
  log(`screenshot ${file.split("/").at(-1)}`);
}

async function context(browser, video) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: TMP, size: { width: 1280, height: 800 } },
    recordHar: { path: join(OUT, `${video}.har`), content: "omit" },
  });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && log(`console error: ${m.text().slice(0, 160)}`));
  ctx.on("request", (r) => {
    const host = new URL(r.url()).hostname;
    if (LIVE_HOST.test(host)) log(`FORBIDDEN request to ${host}`);
  });
  return { ctx, page, video };
}

async function close({ ctx, page, video }) {
  const v = page.video();
  await ctx.close();
  if (v) renameSync(await v.path(), join(OUT, `${video}.webm`));
  log(`video ${video}.webm, har ${video}.har`);
}

async function signedIn(browser, tag, video) {
  const s = await context(browser, video);
  await s.page.goto(users("link", tag));
  await s.page.locator("#auth-confirm-continue").click();
  await s.page.waitForURL((u) => !u.pathname.startsWith("/auth"));
  log(`${email(tag)} signed in`);
  return s;
}

async function onboard(p) {
  const step = p.locator("#onboarding-step");
  await expect(step.or(p.locator("#rail"))).toBeVisible({ timeout: 30000 });
  if (!(await step.isVisible())) return;
  for (let i = 0; i < 12; i++) {
    if (await p.locator("#onboarding-model-providers").isVisible()) {
      await p.locator("#provider-custom-connect").click();
      await p.locator("#provider-custom-url").fill(STUB);
      await p.locator("#provider-custom-name").fill("Stub model");
      await p.locator("#provider-custom-server-key").fill("oab-e2e-stub-key");
      await p.locator("#provider-custom-connect-save").click();
      await expect(p.locator("#onboarding-model-list")).toBeVisible({ timeout: 15000 });
    }
    if (await p.locator("#onboarding-model-list").isVisible()) await p.getByRole("radio", { name: /stub-1/ }).click();
    if (await p.locator("#agent-section-onboarding-name-input").isVisible()) {
      await p.locator("#agent-section-onboarding-name-input").fill("Sage");
      await p.locator("#agent-section-onboarding-look-ember").click();
      await p.locator("#agent-section-onboarding-tone-brief").click();
    }
    if (await p.locator("#onboarding-summary").isVisible()) break;
    await p.locator("#onboarding-next").click();
  }
  await expect(p.locator("#onboarding-summary")).toBeVisible();
  await p.locator("#onboarding-next").click();
  await expect(p.locator("#rail")).toBeVisible();
  log("onboarded with the stub model (a private-network server, admin only)");
}

async function send(p, text) {
  await composer(p).fill(text);
  await composer(p).press("Enter");
}
const settled = (p) => expect(stopBtn(p)).toHaveCount(0, { timeout: 60000 });
async function newChat(p) {
  await p.locator("#sidebar-new-chat").click();
  await expect(composer(p)).toBeVisible();
}
async function refusal(p, title) {
  await expect(notice(p)).toBeVisible({ timeout: 20000 });
  const id = await notice(p).getAttribute("id");
  await expect(p.locator(`[id='${id}-title']`)).toHaveText(title);
  await expect(redBanner(p)).toHaveCount(0);
  log(`notice "${title}": ${await p.locator(`[id='${id}-body']`).innerText()} (no red banner)`);
  return id;
}
const usageNow = async (p) => (await p.request.get(`${APP}/api/usage`)).json();
const stamp = (t) => new Date(t).toISOString().slice(11, 23);
async function untilIdle(p) {
  for (let i = 0; i < 160; i++) {
    if ((await usageNow(p)).running?.mine === 0) return Date.now();
    await p.waitForTimeout(500);
  }
  throw new Error("the run never ended");
}
async function turnstileFrame(p) {
  await expect
    .poll(() => p.frames().filter((f) => f.url().startsWith("https://challenges.cloudflare.com/")).length, { timeout: 30000 })
    .toBeGreaterThan(0);
  return new URL(
    p
      .frames()
      .find((f) => f.url().startsWith("https://challenges.cloudflare.com/"))
      .url(),
  ).host;
}

const scenarios = {
  async "limits-hour"(browser) {
    const s = await signedIn(browser, "a", "3a-hourly-cap");
    const p = s.page;
    await onboard(p);
    for (let i = 1; i <= 2; i++) {
      await send(p, `Tell me one fact about lighthouses (${i}).`);
      await settled(p);
      await expect(meterCount(p)).toHaveText(/requests used/, { timeout: 15000 });
      log(`run ${i}: meter "${await meterCount(p).innerText()}" (no reload)`);
    }
    await shot(p, "meter-after-two-runs");
    const before = used("a");
    await send(p, "A third fact, please.");
    const id = await refusal(p, "Slow down");
    const retry = p.locator(`[id='${id}-retry']`);
    await expect(retry).toBeDisabled();
    const t1 = await p.locator(`[id='${id}-countdown']`).innerText();
    await p.waitForTimeout(3200);
    log(`countdown ticks: "${t1}" -> "${await p.locator(`[id='${id}-countdown']`).innerText()}"; Send again disabled`);
    await shot(p, "notice-limit-hourly");
    log(`counted before: ${before}; after the refusal: ${used("a")} (no charge)`);
    await close(s);
  },

  async "limits-month"(browser) {
    const s = await signedIn(browser, "a", "3b-monthly-cap");
    const p = s.page;
    const meter = p.locator("#sidebar-usage-meter");
    await expect(meterCount(p)).toHaveText(/of 5 requests used/, { timeout: 30000 });
    const start = Number((await meterCount(p).innerText()).split(" ")[0]);
    await expect(meter).toHaveAttribute("data-level", "normal");
    log(`meter: "${await meterCount(p).innerText()}" (normal)`);
    await shot(p, "meter-normal");
    await newChat(p);
    for (let n = start + 1; n <= 5; n++) {
      await send(p, `One more fact about lighthouses (${n}).`);
      await settled(p);
      await expect(meterCount(p)).toHaveText(`${n} of 5 requests used`, { timeout: 15000 });
      const level = await meter.getAttribute("data-level");
      log(`run ${n}: meter "${await meterCount(p).innerText()}", level ${level}`);
      if (n === 4) {
        await expect(meter).toHaveAttribute("data-level", "low");
        await expect(p.locator("#sidebar-usage-meter-low")).toBeVisible();
        log(`low: "${await p.locator("#sidebar-usage-meter-low").innerText()}"`);
        await shot(p, "meter-low");
      }
    }
    await expect(meter).toHaveAttribute("data-level", "exhausted");
    await shot(p, "meter-exhausted");
    await send(p, "And another one.");
    const id = await refusal(p, "You've used this month's 5 requests");
    await expect(p.locator(`[id='${id}-body']`)).toHaveText(/Requests open again on 1 /);
    await expect(p.locator(`[id='${id}-mac-link']`)).toHaveText("Run it on your Mac");
    log(`Mac link: ${await p.locator(`[id='${id}-mac-link']`).getAttribute("href")}`);
    await expect(meterCount(p)).toHaveText("5 of 5 requests used");
    await shot(p, "notice-limit-monthly");
    log(`GET /api/usage -> ${JSON.stringify(await usageNow(p))}`);
    log(used("a"));
    await close(s);
  },

  async "limits-running"(browser) {
    const s = await signedIn(browser, "a", "3c-running-per-user");
    const a = s.page;
    await expect(meterCount(a)).toHaveText(/requests used/, { timeout: 30000 });
    await newChat(a);
    await send(a, "[e2e:long] Write a very long beacon poem.");
    await expect(stopBtn(a)).toBeVisible();
    log("chat A: a long stub run holds A's only running slot");
    const b = await s.ctx.newPage();
    await b.goto(APP);
    await newChat(b);
    await send(b, "A quick question in chat B.");
    const id = await refusal(b, "Still working");
    await expect(b.locator(`[id='${id}-retry']`)).toBeEnabled();
    await shot(b, "notice-limit-running");
    await a.bringToFront();
    await stopBtn(a).click();
    const t0 = Date.now();
    log(`t0 ${stamp(t0)}: stopped chat A during its run; running.mine = ${(await usageNow(a)).running?.mine}`);
    const t1 = await untilIdle(a);
    log(`t1 ${stamp(t1)} (+${t1 - t0} ms): A's cleanup finished, running.mine = 0; until then a send in B is refused limit_running`);
    await b.bringToFront();
    await b.locator(`[id='${id}-retry']`).click();
    await settled(b);
    await expect(notice(b)).toHaveCount(0);
    const t2 = Date.now();
    log(`t2 ${stamp(t2)} (+${t2 - t0} ms): chat B admitted after t1, no notice`);
    await shot(b, "chat-b-admitted");
    log(used("a"));
    const v = b.video();
    await b.close();
    if (v) renameSync(await v.path(), join(OUT, "3c-running-per-user-chat-b.webm"));
    await close(s);
  },

  async "limits-server"(browser) {
    const a = await signedIn(browser, "a", "3d-server-busy-a");
    const n = await signedIn(browser, "n", "3d-server-busy-n");
    await expect(meterCount(a.page)).toHaveText(/requests used/, { timeout: 30000 });
    await newChat(a.page);
    await send(a.page, "[e2e:long] Write a very long beacon poem.");
    await expect(stopBtn(a.page)).toBeVisible();
    log("A's long run holds the only server slot (LIMIT_RUNNING_SERVER=1)");
    await expect(composer(n.page)).toBeVisible({ timeout: 30000 });
    await send(n.page, "Is the server free?");
    const id = await refusal(n.page, "Busy");
    await expect(n.page.locator(`[id='${id}-retry']`)).toBeDisabled();
    log(`N countdown: ${await n.page.locator(`[id='${id}-countdown']`).innerText()}`);
    await shot(n.page, "notice-server-busy");
    await stopBtn(a.page).click();
    await untilIdle(a.page);
    log("A stopped; the server slot is free");
    await expect(n.page.locator(`[id='${id}-countdown']`)).toHaveText("You can send again now.", { timeout: 75000 });
    await expect(n.page.locator(`[id='${id}-retry']`)).toBeEnabled();
    await shot(n.page, "notice-server-busy-countdown-done");
    const before = Number(used("n").match(/: (\d+) counted/)[1]);
    log(`N counted before Send again: ${before}`);
    await n.page.locator(`[id='${id}-retry']`).click();
    await settled(n.page);
    await expect(notice(n.page)).toHaveCount(0);
    await expect.poll(() => Number(used("n").match(/: (\d+) counted/)[1]), { timeout: 15000 }).toBe(before + 1);
    const answer = (await redBanner(n.page).allInnerTexts()).join(" ") || "(no error)";
    log(
      `N's Send again was admitted (no Busy notice) and counted: ${before} -> ${before + 1}; N has no model, so the run ends with: ${answer}`,
    );
    await shot(n.page, "server-free-n-admitted");
    await close(n);
    await close(a);
  },

  async "limits-unavailable"(browser) {
    sql("revoke execute on function public.request_admit(uuid, int, int, timestamptz) from service_role");
    sql("notify pgrst, 'reload schema'");
    const s = await signedIn(browser, "a", "3e-usage-unavailable");
    const p = s.page;
    log("sign-in works while the usage function is revoked");
    await expect(meterCount(p)).toHaveText(/requests used/, { timeout: 30000 });
    const before = await meterCount(p).innerText();
    await newChat(p);
    await send(p, "Can I send while usage is down?");
    await refusal(p, "Can't send right now");
    await expect(meterCount(p)).toHaveText(before);
    await shot(p, "notice-usage-unavailable");
    log(`meter unchanged (${before}); ${used("a")}`);
    sql("grant execute on function public.request_admit(uuid, int, int, timestamptz) to service_role");
    sql("notify pgrst, 'reload schema'");
    await p.waitForTimeout(1500);
    await newChat(p);
    await send(p, "And now?");
    await settled(p);
    await expect(notice(p)).toHaveCount(0);
    await shot(p, "sends-again-after-regrant");
    log(used("a"));
    sql("revoke execute on function public.request_usage_get(uuid, timestamptz) from service_role");
    sql("notify pgrst, 'reload schema'");
    await p.waitForTimeout(1500);
    await p.reload();
    await expect(p.locator("#sidebar-usage-meter-unavailable")).toHaveText("Usage unavailable", { timeout: 30000 });
    await expect(p.locator("#sidebar-usage-meter-retry")).toBeVisible();
    log('request_usage_get revoked: the meter shows "Usage unavailable" with Retry');
    await shot(p, "meter-unavailable");
    sql("grant execute on function public.request_usage_get(uuid, timestamptz) to service_role");
    sql("notify pgrst, 'reload schema'");
    await p.waitForTimeout(1500);
    await p.locator("#sidebar-usage-meter-retry").click();
    await expect(meterCount(p)).toHaveText(/requests used/, { timeout: 15000 });
    log(`re-granted, Retry: meter "${await meterCount(p).innerText()}"`);
    await shot(p, "meter-back-after-retry");
    await close(s);
  },

  async admin(browser) {
    const s = await signedIn(browser, "a", "4-admin-usage");
    const p = s.page;
    const [{ n }] = sql(
      "select count(*)::int as n from public.request_usage where month = date_trunc('month', now() at time zone 'utc')::date and count > 0",
    );
    const [{ seeds }] = sql(
      "select count(*)::int as seeds from public.request_usage u join auth.users a on a.id = u.user_id where u.month = date_trunc('month', now() at time zone 'utc')::date and u.count > 0 and a.email like 'oab-m7+demo-seed%'",
    );
    log(`the list total is dynamic: ${n} users with usage this month = ${seeds} seeds + ${n - seeds} other demo users (A)`);
    await p.goto(`${APP}/admin`);
    await p.locator("#admin-tab-usage").click();
    await expect(p.locator("#admin-panel-usage")).toBeVisible();
    await expect(p.locator("#admin-usage-count")).toHaveText(`Showing 1–5 of ${n} · newest first · 5 per page`, { timeout: 20000 });
    log(`totals: ${(await p.locator("#admin-usage-numbers").innerText()).replace(/\n/g, " | ")}`);
    log(`limits: ${await p.locator("#admin-usage-limits").innerText()}; ${await p.locator("#admin-usage-signup-mode").innerText()}`);
    await shot(p, "totals-and-page-1");
    await p.locator("#admin-usage-next").click();
    await expect(p.locator("#admin-usage-count")).toHaveText(new RegExp(`^Showing 6–${Math.min(10, n)} of ${n}`));
    await shot(p, "page-2");
    await p.locator("#admin-usage-prev").click();
    const first = p.locator("#admin-usage-list li[id^='admin-usage-row-']").first();
    await first.locator("[id$='-view']").click();
    const detail = p.locator("[id^='admin-usage-detail-'][id$='-list']");
    await expect(detail).toBeVisible();
    log(`View: ${(await detail.innerText()).replace(/\n/g, " | ")}`);
    await shot(p, "view-detail");
    await first.locator("[id$='-select']").click();
    const picked = (await p.locator("#admin-usage-selection-text").innerText()).replace("Selected: ", "");
    log(`Select: ${picked}`);
    await p.locator("#admin-usage-open-user").click();
    await expect(p.locator("#admin-tab-users")).toHaveAttribute("aria-selected", "true");
    await expect(p.locator("#admin-users-search-input")).toHaveValue(picked);
    await shot(p, "open-in-users");
    await p.locator("#admin-tab-usage").click();
    await p.locator("#admin-usage-search").pressSequentially("SEED0", { delay: 40 });
    await expect(p.locator("#admin-usage-count")).toHaveText(new RegExp(`^Showing 1–5 of ${seeds} `), { timeout: 15000 });
    await shot(p, "search-seed");
    await p.locator("#admin-usage-search").fill("");
    await expect(p.locator("#admin-usage-count")).toHaveText(`Showing 1–5 of ${n} · newest first · 5 per page`, { timeout: 15000 });
    await p.locator("#admin-usage-filter").selectOption("at_limit");
    await expect(p.locator("#admin-usage-empty")).toHaveText("No users match these filters.", { timeout: 15000 });
    log("filter at the monthly limit (1,000): no user is at it");
    await shot(p, "filter-at-limit-empty");
    await p.locator("#admin-usage-filter").selectOption("all");
    await expect(p.locator("#admin-usage-count")).toHaveText(`Showing 1–5 of ${n} · newest first · 5 per page`, { timeout: 15000 });
    await p.locator("#admin-usage-next").click();
    await expect(p.locator("#admin-usage-count")).toHaveText(new RegExp(`^Showing 6–${Math.min(10, n)} of ${n}`));
    log(users("delete", "seed01"));
    log(users("delete", "seed02"));
    log(users("delete", "seed03"));
    await p.locator("#admin-usage-refresh").click();
    await expect(p.locator("#admin-usage-count")).toHaveText(new RegExp(`of ${n - 3} `), { timeout: 15000 });
    log(
      `past the end after three deletions: ${await p.locator("#admin-usage-count").innerText()} (${await p.locator("#admin-usage-page").innerText()})`,
    );
    await shot(p, "stepped-back-to-last-page");
    await close(s);
    const m = await signedIn(browser, "n", "4-member-admin-404");
    await m.page.goto(`${APP}/admin`, { timeout: 30000 });
    await expect(m.page.locator("#shell-not-found")).toBeVisible({ timeout: 30000 });
    log("member N: /admin shows the not-found page");
    await shot(m.page, "member-admin-not-found");
    await close(m);
  },

  async capability(browser) {
    const s = await signedIn(browser, "a", "5-capability-window");
    const p = s.page;
    await expect(meterCount(p)).toHaveText(/requests used/, { timeout: 30000 });
    await newChat(p);
    await send(p, "Hello from the admin's private-network model.");
    await settled(p);
    await expect(redBanner(p)).toHaveCount(0);
    await shot(p, "admin-private-model-works");
    log(`demote A with SQL (token unchanged): ${users("demote", "a")} row`);
    const t = Date.now();
    await p.waitForTimeout(32000);
    await send(p, "And now, in the same chat?");
    await expect(redBanner(p)).toBeVisible({ timeout: 30000 });
    log(`after ${Math.round((Date.now() - t) / 1000)} s, the same chat: ${await redBanner(p).innerText()}`);
    await shot(p, "same-chat-private-model-refused");
    log(`promote A back: ${users("promote", "a")} row`);
    await close(s);
  },

  async "pages-waitlist"(browser) {
    const s = await context(browser, "6-pages-waitlist");
    const p = s.page;
    await p.goto(`${APP}/request-access`);
    await expect(p.locator("#request-access form").first()).toBeVisible();
    await shot(p, "request-access-form");
    await p.goto(`${APP}/login`);
    await expect(p.locator("#login-request-link")).toBeVisible();
    await expect(p.locator("#login-legal")).toHaveCount(0);
    await shot(p, "login-waitlist");
    log("waitlist: the request form, and /login links to it");
    await close(s);
  },

  async "pages-invite"(browser) {
    const s = await context(browser, "6-pages-invite");
    const p = s.page;
    await p.goto(`${APP}/request-access`);
    await expect(p.locator("#request-access-closed")).toHaveText("We're not taking requests right now.");
    await shot(p, "request-access-closed");
    log("invite: /request-access is not taking requests");
    await close(s);
  },

  async "pages-unknown"(browser) {
    const s = await context(browser, "6-pages-unknown");
    const p = s.page;
    await p.goto(`${APP}/login`);
    await expect(p.locator("#login-request-link")).toBeVisible();
    await expect(p.locator("#login-legal")).toHaveCount(0);
    await shot(p, "login-unknown-shows-waitlist");
    log("mode unknown (lookup revoked): the pages show waitlist");
    await close(s);
  },

  async "pages-open"(browser) {
    const s = await context(browser, "6-pages-open");
    const p = s.page;
    await p.goto(`${APP}/request-access`);
    await p.waitForURL((u) => u.pathname === "/login");
    log("open: /request-access redirects to /login");
    await expect(p.locator("#login-legal")).toBeVisible();
    log(`open /login: "${await p.locator("#login-legal").innerText()}"`);
    await p.locator("#login-email-toggle").click();
    log(`email-link form loads Turnstile from ${await turnstileFrame(p)}`);
    await expect(p.locator("#login-email-submit")).toBeEnabled({ timeout: 30000 });
    await shot(p, "login-open-terms-and-turnstile");
    await close(s);
  },

  async "check-pass"(browser) {
    const s = await signedIn(browser, "h1", "6-human-check-pass");
    const p = s.page;
    await onboard(p);
    await send(p, "Tell me one fact about lighthouses.");
    const id = await refusal(p, "One quick check");
    log(`before the check: ${used("h1")}`);
    await shot(p, "notice-human-check-required");
    await p.locator(`[id='${id}-check-open']`).click();
    await expect(p.locator("#human-check-dialog")).toBeVisible();
    log(`Turnstile frame from ${await turnstileFrame(p)} (always-pass test site key)`);
    await shot(p, "dialog-turnstile");
    await expect(p.locator("#human-check-dialog")).toHaveCount(0, { timeout: 30000 });
    await settled(p);
    await expect(notice(p)).toHaveCount(0);
    await shot(p, "run-admitted-after-check");
    log(`after the check: ${used("h1")}`);
    await close(s);
  },

  async "check-fail"(browser) {
    const s = await signedIn(browser, "h2", "6-human-check-fail");
    const p = s.page;
    await onboard(p);
    await send(p, "Tell me one fact about lighthouses.");
    const id = await refusal(p, "One quick check");
    await p.locator(`[id='${id}-check-open']`).click();
    await expect(p.locator("#human-check-error")).toHaveText("We couldn't verify that. Try again.", { timeout: 30000 });
    await shot(p, "dialog-verify-failed");
    log(`always-fail secret: ${used("h2")}`);
    await p.locator("#human-check-cancel").click();
    await close(s);
  },

  async "check-none"(browser) {
    const s = await signedIn(browser, "h3", "6-human-check-no-secret");
    const p = s.page;
    await onboard(p);
    await send(p, "Tell me one fact about lighthouses.");
    await refusal(p, "Can't send right now");
    await shot(p, "notice-human-check-unavailable");
    log(`no TURNSTILE_SECRET_KEY: ${used("h3")}`);
    await close(s);
  },

  async delete(browser) {
    const s = await signedIn(browser, "d", "7-self-delete");
    const p = s.page;
    await expect(p.locator("#rail")).toBeVisible({ timeout: 30000 });
    await p.locator("#account-menu-button").click();
    await p.locator("#account-menu-profile").click();
    await expect(p.locator("#profile-drawer-panel")).toBeVisible();
    await p.locator("#profile-delete-account").scrollIntoViewIfNeeded();
    await p.locator("#profile-delete-account").click();
    await expect(p.locator("#delete-account-dialog")).toBeVisible();
    await p.locator("#delete-account-email").fill("someone-else@example.test");
    await expect(p.locator("#delete-account-confirm")).toBeDisabled();
    await shot(p, "wrong-email-refused");
    log("a wrong email keeps Delete disabled");
    await p.locator("#delete-account-email").fill(email("d"));
    await expect(p.locator("#delete-account-confirm")).toBeEnabled();
    await shot(p, "email-typed");
    await p.locator("#delete-account-confirm").click();
    await expect(p.locator("#landing-footer")).toBeVisible({ timeout: 30000 });
    const cookies = (await s.ctx.cookies()).filter((c) => c.name.startsWith("sb-")).length;
    const left = users("id", "d");
    log(`after delete: sb- cookies ${cookies}, auth user ${left || "gone"}`);
    if (cookies !== 0 || left) throw new Error("the account or the session survived the delete");
    log(`tombstones: ${JSON.stringify(sql("select count(*)::int as n from private.usage_tombstones"))}`);
    await shot(p, "signed-out-landing");
    await close(s);
  },

  async legal(browser) {
    const s = await context(browser, "7-legal-drafts");
    const p = s.page;
    for (const doc of ["terms", "privacy"]) {
      await p.goto(`${APP}/${doc}`);
      await expect(p.locator("#legal-draft-banner")).toBeVisible();
      log(`/${doc}: ${await p.locator("#legal-draft-banner").innerText()}`);
      await shot(p, `${doc}-draft-banner`);
    }
    await close(s);
  },
};

const wanted = process.argv.slice(2);
const unknown = wanted.filter((w) => !scenarios[w]);
if (!wanted.length || unknown.length) {
  console.error(`usage: browser.mjs <${Object.keys(scenarios).join("|")}>…`);
  process.exit(2);
}
const browser = await chromium.launch();
try {
  for (const name of wanted) {
    scenario = name;
    shotN = 0;
    log(`=== ${name}`);
    await scenarios[name](browser);
  }
} finally {
  await browser.close();
}
