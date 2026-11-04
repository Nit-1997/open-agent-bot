import type { RunRefusal } from "@oab/shared/runRefusals";
import { RUN_REFUSAL_CODES } from "@oab/shared/runRefusals";
import { describe, expect, it } from "vitest";
import {
  countdownText,
  DESKTOP_URL,
  longUtcDay,
  METER_COPY,
  meterLevel,
  refusalCopy,
  retryDeadline,
  secondsUntil,
  shortUtcDay,
} from "@/lib/usageCopy";

const NOW = Date.parse("2026-11-04T12:00:00.000Z");

const refusal = (r: Partial<RunRefusal> & Pick<RunRefusal, "code">): RunRefusal => ({ message: "server says", ...r });

describe("usage copy", () => {
  it("points the Mac link at the latest GitHub release", () => {
    expect(DESKTOP_URL).toBe("https://github.com/Nit-1997/open-agent-bot/releases/latest");
  });

  it("formats reset days in UTC", () => {
    expect(shortUtcDay("2026-12-01T00:00:00.000Z")).toBe("1 Dec");
    expect(longUtcDay("2026-12-01T00:00:00.000Z")).toBe("1 December");
    expect(shortUtcDay("2027-01-01T00:00:00.000Z")).toBe("1 Jan");
    expect(longUtcDay("2026-11-30T23:59:59.999Z")).toBe("30 November");
  });

  it("words the meter lines", () => {
    expect(METER_COPY.label).toBe("This month");
    expect(METER_COPY.reset("2026-12-01T00:00:00.000Z")).toBe("resets 1 Dec");
    expect(METER_COPY.resetHint).toBe("00:00 UTC");
    expect(METER_COPY.count(42, 50)).toBe("42 of 50 requests used");
    expect(METER_COPY.low(8)).toBe("8 requests left this month.");
    expect(METER_COPY.low(1)).toBe("1 request left this month.");
    expect(`${METER_COPY.macLead}${METER_COPY.macLink}${METER_COPY.macTail}`).toBe(
      "Want no limits? Run Open Agent on your own Mac. It's free and open source.",
    );
    expect(METER_COPY.exhausted("2026-12-01T00:00:00.000Z")).toBe("Requests open again on 1 December.");
    expect(METER_COPY.check).toBe("One quick check before your first message");
    expect(METER_COPY.unavailable).toBe("Usage unavailable");
  });

  it.each([
    [0, 50, "normal"],
    [40, 50, "normal"],
    [41, 50, "low"],
    [49, 50, "low"],
    [50, 50, "exhausted"],
    [51, 50, "exhausted"],
    [0, 1, "normal"],
    [1, 1, "exhausted"],
    [7, 10, "normal"],
    [8, 10, "low"],
    [3, 4, "low"],
  ] as const)("used %i of %i is %s", (used, limit, level) => {
    expect(meterLevel(used, limit)).toBe(level);
  });

  it("counts down in whole seconds and never below zero", () => {
    expect(secondsUntil(NOW + 40_000, NOW)).toBe(40);
    expect(secondsUntil(NOW + 39_001, NOW)).toBe(40);
    expect(secondsUntil(NOW, NOW)).toBe(0);
    expect(secondsUntil(NOW - 5000, NOW)).toBe(0);
    expect(countdownText(40)).toBe("You can send again in 40 seconds.");
    expect(countdownText(1)).toBe("You can send again in 1 second.");
    expect(countdownText(0)).toBe("You can send again now.");
  });

  it("takes the retry deadline from retryAt, then retryAfter, then now", () => {
    expect(retryDeadline(refusal({ code: "limit_hourly", retryAt: "2026-11-04T12:00:40.000Z", retryAfter: 99 }), NOW)).toBe(NOW + 40_000);
    expect(retryDeadline(refusal({ code: "server_busy", retryAfter: 60 }), NOW)).toBe(NOW + 60_000);
    expect(retryDeadline(refusal({ code: "limit_running" }), NOW)).toBe(NOW);
  });
});

describe("refusal notice copy (D13)", () => {
  it("the monthly cap names the cap and the reset day, links the Mac app, and offers no Send again", () => {
    expect(refusalCopy(refusal({ code: "limit_monthly", limit: 50, used: 50, retryAt: "2026-12-01T00:00:00.000Z" }), 0, NOW)).toEqual({
      title: "You've used this month's 50 requests",
      body: "Your chats and reports are still here. Requests open again on 1 December.",
      countdown: false,
      sendAgain: "none",
      macLink: true,
    });
    expect(refusalCopy(refusal({ code: "limit_monthly", limit: 1 }), 0, NOW).title).toBe("You've used this month's 1 request");
    expect(refusalCopy(refusal({ code: "limit_monthly" }), 0, NOW).body).toBe(
      "Your chats and reports are still here. Requests open again on 1 December.",
    );
  });

  it.each(["limit_hourly", "limit_attempts"] as const)("%s says slow down with the seconds left", (code) => {
    expect(refusalCopy(refusal({ code }), 40, NOW)).toEqual({
      title: "Slow down",
      body: "You're sending messages quickly. Try again in 40 seconds.",
      countdown: true,
      sendAgain: "countdown",
      macLink: false,
    });
    expect(refusalCopy(refusal({ code }), 1, NOW).body).toBe("You're sending messages quickly. Try again in 1 second.");
  });

  it("server busy counts down", () => {
    expect(refusalCopy(refusal({ code: "server_busy", retryAfter: 60 }), 60, NOW)).toEqual({
      title: "Busy",
      body: "The demo server is at capacity right now. Try again in a minute.",
      countdown: true,
      sendAgain: "countdown",
      macLink: false,
    });
  });

  it("still working follows the running cap and can be sent again right away", () => {
    expect(refusalCopy(refusal({ code: "limit_running", limit: 1, used: 1 }), 0, NOW)).toEqual({
      title: "Still working",
      body: "You can run one chat at a time. Wait for the other one to finish or stop it.",
      countdown: false,
      sendAgain: "now",
      macLink: false,
    });
    expect(refusalCopy(refusal({ code: "limit_running", limit: 3 }), 0, NOW).body).toBe(
      "You can run 3 chats at a time. Wait for one of the others to finish or stop it.",
    );
  });

  it.each(["usage_unavailable", "human_check_unavailable"] as const)("%s shows the server message and counts down", (code) => {
    expect(refusalCopy(refusal({ code, message: "Can't check your usage right now. Try again in a minute." }), 60, NOW)).toEqual({
      title: "Can't send right now",
      body: "Can't check your usage right now. Try again in a minute.",
      countdown: true,
      sendAgain: "countdown",
      macLink: false,
    });
  });

  it("the human check asks for the one quick check", () => {
    expect(refusalCopy(refusal({ code: "human_check_required" }), 0, NOW)).toEqual({
      title: "One quick check",
      body: "Confirm you're human before your first message.",
      countdown: false,
      sendAgain: "none",
      macLink: false,
    });
  });

  it("has copy for every shared refusal code", () => {
    for (const code of RUN_REFUSAL_CODES) expect(refusalCopy(refusal({ code }), 0, NOW).title.length, code).toBeGreaterThan(0);
  });
});
