import { describe, expect, it } from "vitest";
import { ConcurrencyGate, RateLimiter, rateLimitError } from "../../src/lib/rateLimit.js";
import { LocalRunPolicy } from "../../src/policy/localRunPolicy.js";
import type { Admission, RunTicket } from "../../src/policy/types.js";
import { ALICE, BOB, CHAT_1 } from "../fixtures/users.js";

const runOf = (principal = ALICE, runId = "r") => ({ principal, chatId: CHAT_1, runId });

function ticketOf(a: Admission): RunTicket {
  if (!a.ok) throw new Error(`refused: ${a.error.message}`);
  return a.ticket;
}

function errorOf(a: Admission) {
  if (a.ok) throw new Error("admitted");
  return a.error;
}

describe("LocalRunPolicy", () => {
  it("refuses the 31st run in ten minutes with today's retryAfter", async () => {
    const t0 = 1_000_000;
    const policy = new LocalRunPolicy({ limiter: new RateLimiter({ now: () => t0 }), gate: new ConcurrencyGate(100) });
    for (let i = 0; i < 30; i++) ticketOf(await policy.admit(runOf())).end();
    const error = errorOf(await policy.admit(runOf()));
    expect(error).toEqual(rateLimitError(600));
    expect(error.kind).toBe("rate_limited");
    expect(error.opts.retryAfter).toBe(600);
  });

  it("refuses a third concurrent run with retryAfter 5 after consuming the rate token", async () => {
    const policy = new LocalRunPolicy({ limiter: new RateLimiter(), gate: new ConcurrencyGate(2), limit: { max: 3, windowMs: 60_000 } });
    const first = ticketOf(await policy.admit(runOf()));
    ticketOf(await policy.admit(runOf()));
    const third = errorOf(await policy.admit(runOf()));
    expect(third).toEqual(rateLimitError(5));
    expect(third.opts.retryAfter).toBe(5);
    first.end();
    const fourth = errorOf(await policy.admit(runOf()));
    expect(fourth.kind).toBe("rate_limited");
    expect(fourth.opts.retryAfter).toBe(60);
  });

  it("frees the slot on end, and a second end frees nothing more", async () => {
    const policy = new LocalRunPolicy({ limiter: new RateLimiter(), gate: new ConcurrencyGate(1) });
    const ticket = ticketOf(await policy.admit(runOf()));
    expect(errorOf(await policy.admit(runOf())).opts.retryAfter).toBe(5);
    ticket.end();
    ticket.end();
    ticketOf(await policy.admit(runOf()));
    expect(errorOf(await policy.admit(runOf())).opts.retryAfter).toBe(5);
  });

  it("keys rate and concurrency per principal", async () => {
    const policy = new LocalRunPolicy({ limiter: new RateLimiter(), gate: new ConcurrencyGate(1), limit: { max: 1, windowMs: 60_000 } });
    const alice = ticketOf(await policy.admit(runOf(ALICE)));
    ticketOf(await policy.admit(runOf(BOB)));
    alice.end();
    expect(errorOf(await policy.admit(runOf(ALICE))).kind).toBe("rate_limited");
  });

  it("uses the shared limiter under the run:<id> key", async () => {
    const limiter = new RateLimiter();
    const policy = new LocalRunPolicy({ limiter, gate: new ConcurrencyGate(100), limit: { max: 1, windowMs: 60_000 } });
    ticketOf(await policy.admit(runOf())).end();
    expect(limiter.take(`run:${ALICE.id}`, { max: 1, windowMs: 60_000 }).ok).toBe(false);
  });
});
