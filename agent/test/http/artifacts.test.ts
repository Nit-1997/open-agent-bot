import { describe, expect, it } from "vitest";
import { makeApp } from "../fixtures/app.js";
import { ALICE, BOB } from "../fixtures/users.js";

describe("artifact routes", () => {
  it("serves the owner's report with the sandbox CSP, nosniff and no caching", async () => {
    const { call, artifacts, db } = await makeApp();
    const { id } = await artifacts.save(db.forUser(ALICE.id), null, "Diwali Plan!", "<html><body><h1>Plan</h1></body></html>");
    const res = await call(ALICE, `/artifacts/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe("sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("<h1>Plan</h1>");
  });

  it("answers 404 for another user's report and for unknown ids", async () => {
    const { call, artifacts, db } = await makeApp();
    const { id } = await artifacts.save(db.forUser(ALICE.id), null, "Mine", "<p/>");
    expect((await call(BOB, `/artifacts/${id}`)).status).toBe(404);
    expect((await call(BOB, `/artifacts/${id}.pdf`)).status).toBe(404);
    expect((await call(ALICE, "/artifacts/abcdefghijkl")).status).toBe(404);
  });

  it("serves the PDF as a download named after the title", async () => {
    const { call, artifacts, db } = await makeApp();
    const { id } = await artifacts.save(db.forUser(ALICE.id), null, "Diwali Plan!", "<h1>Plan</h1>");
    const res = await call(ALICE, `/artifacts/${id}.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="diwali-plan.pdf"');
    expect(
      Buffer.from(await res.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe("%PDF");
  });
});
