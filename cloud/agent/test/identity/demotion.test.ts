import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemotionHook } from "../../src/identity/demotion.js";
import { flush } from "../../../../packages/core/test/agui/runWorld.js";
import { ADMIN, ALICE } from "../fixtures/users.js";

afterEach(() => vi.restoreAllMocks());

describe("createDemotionHook", () => {
  it("calls the bound handler and waits for it", async () => {
    const hook = createDemotionHook();
    const order: string[] = [];
    hook.bind(async (id) => {
      await flush();
      order.push(`handled ${id}`);
    });
    await hook.notify(ADMIN.id);
    order.push("returned");
    expect(order).toEqual([`handled ${ADMIN.id}`, "returned"]);
  });

  it("queues demotions that arrive before binding and replays each once when bound", async () => {
    const hook = createDemotionHook();
    await hook.notify(ADMIN.id);
    await hook.notify(ALICE.id);
    await hook.notify(ADMIN.id);
    const handler = vi.fn(async () => {});
    hook.bind(handler);
    await flush();
    expect(handler.mock.calls).toEqual([[ADMIN.id], [ALICE.id]]);
    await hook.notify(ALICE.id);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("logs a replayed handler that fails instead of throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const hook = createDemotionHook();
    await hook.notify(ADMIN.id);
    hook.bind(async () => Promise.reject(new Error("forget failed")));
    await flush();
    expect(error.mock.calls.flat().join(" ")).toContain(`[auth] demotion cleanup failed user=${ADMIN.id}`);
  });

  it("refuses a second binding", () => {
    const hook = createDemotionHook();
    hook.bind(async () => {});
    expect(() => hook.bind(async () => {})).toThrow("the demotion hook is already bound");
  });
});
