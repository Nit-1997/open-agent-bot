import { describe, expect, it, vi } from "vitest";
import { LIMITS } from "../../src/lib/rateLimit.js";
import { makeApp } from "../fixtures/app.js";
import { ALICE, BOB } from "../fixtures/users.js";

describe("artifact routes", () => {
  it("serves the owner's report with the sandbox CSP, nosniff and no caching", async () => {
    const { call, artifacts, db } = await makeApp();
    const { id } = await artifacts.save(db.forUser(ALICE.id), null, "Diwali Plan!", "<html><body><h1>Plan</h1></body></html>");
    const res = await call(ALICE, `/artifacts/${id}`);
    expect(res.status).toBe(200);
    const csp = Object.fromEntries(
      (res.headers.get("content-security-policy") ?? "").split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1).join(" ")]),
    );
    expect(csp).toMatchObject({
      "default-src": "'none'",
      "script-src": "'unsafe-inline'",
      "style-src": "'unsafe-inline' https://fonts.googleapis.com",
      "font-src": "https://fonts.gstatic.com",
      "img-src": "data:",
      "connect-src": "'none'",
      "form-action": "'none'",
      "base-uri": "'none'",
      sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox",
    });
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

  it("serves the owner's thumbnail as a private JPEG and 404s for another user or a bad id", async () => {
    const { call, artifacts, db } = await makeApp();
    const { id } = await artifacts.save(db.forUser(ALICE.id), null, "Trip", "<h1>Plan</h1>");
    const res = await call(ALICE, `/artifacts/${id}.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("JPG 13");
    expect((await call(BOB, `/artifacts/${id}.jpg`)).status).toBe(404);
    expect((await call(ALICE, "/artifacts/short.jpg")).status).toBe(404);
    expect((await call(ALICE, `/artifacts/${id}.html.jpg`)).status).toBe(404);
  });

  it("limits every artifact request to 600 per 10 minutes", async () => {
    const { call, artifacts, db } = await makeApp();
    const { id } = await artifacts.save(db.forUser(ALICE.id), null, "Trip", "<p/>");
    for (let i = 0; i < 600; i++) expect((await call(ALICE, `/artifacts/${id}`)).status).toBe(200);
    const res = await call(ALICE, `/artifacts/${id}`);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
    expect((await call(BOB, "/artifacts/abcdefghijkl")).status).toBe(404);
  });

  it("charges thumbnails and PDFs to separate limits, only for requests that start a render", async () => {
    const { call, artifacts, db } = await makeApp();
    const alice = db.forUser(ALICE.id);
    const cached = await artifacts.save(alice, null, "Cached", "<p/>");
    expect((await call(ALICE, `/artifacts/${cached.id}.pdf`)).status).toBe(200);
    expect((await call(ALICE, `/artifacts/${cached.id}.jpg`)).status).toBe(200);
    const ids: string[] = [];
    for (let i = 0; i < LIMITS.thumbs.max + 1; i++) {
      const id = `report${String(i).padStart(6, "0")}`;
      await alice.artifacts.insert({ id, chatId: null, title: "T", sizeBytes: 3 });
      await alice.storage.upload(id, "html", Buffer.from("<p/>"));
      ids.push(id);
    }
    for (const id of ids.slice(0, LIMITS.pdfs.max - 1)) expect((await call(ALICE, `/artifacts/${id}.pdf`)).status).toBe(200);
    const pdfLimited = await call(ALICE, `/artifacts/${ids[LIMITS.pdfs.max]}.pdf`);
    expect(pdfLimited.status).toBe(429);
    expect(Number(pdfLimited.headers.get("retry-after"))).toBeGreaterThan(0);
    for (const id of ids.slice(0, LIMITS.thumbs.max)) expect((await call(ALICE, `/artifacts/${id}.jpg`)).status).toBe(200);
    expect((await call(ALICE, `/artifacts/${ids[LIMITS.thumbs.max]}.jpg`)).status).toBe(429);
    expect((await call(ALICE, `/artifacts/${cached.id}.pdf`)).status).toBe(200);
    expect((await call(ALICE, `/artifacts/${cached.id}.jpg`)).status).toBe(200);
    expect((await call(BOB, `/artifacts/${cached.id}.jpg`)).status).toBe(404);
  });

  it("answers a thumbnail that failed recently with 503 and no new render", async () => {
    const renderThumb = vi.fn(async () => {
      throw new Error("chromium gone");
    });
    const { call, db } = await makeApp({ renderThumb });
    const alice = db.forUser(ALICE.id);
    await alice.artifacts.insert({ id: "failingthumb", chatId: null, title: "T", sizeBytes: 3 });
    await alice.storage.upload("failingthumb", "html", Buffer.from("<p/>"));
    const first = await call(ALICE, "/artifacts/failingthumb.jpg");
    const second = await call(ALICE, "/artifacts/failingthumb.jpg");
    expect([first.status, second.status]).toEqual([503, 503]);
    expect(await second.json()).toMatchObject({ error: "no_preview" });
    expect(renderThumb).toHaveBeenCalledTimes(1);
  });
});
