import { randomBytes, randomUUID } from "node:crypto";
import { CHATS_PAGE_SIZE, REPORTS_PAGE_SIZE, SEARCH_MAX, SEARCH_MIN, SEARCH_PAGE_SIZE } from "@oab/shared/lists";
import { emptyProfile } from "@oab/shared/profile";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CredentialRow, NewMessage, UserRepos } from "../../src/db/types.js";
import { UserError, type UserErrorKind } from "../../src/lib/errors.js";
import { readStoredProfile } from "../../src/profile/store.js";

export type StoreUnderTest = { forUser(userId: string): UserRepos };
export type ContractHarness = { store: StoreUnderTest; newUser(): Promise<string>; dispose(): Promise<void> };

const TITLE_MAX = 200;
const DEFAULT_SETTINGS = { custom: {}, enabled: {}, hidden: [] };

export const artifactId = () => randomBytes(9).toString("base64url");

const message = (content: string, extra: Partial<NewMessage> = {}): NewMessage => ({ role: "user", content, status: "complete", ...extra });

const credential = (provider: string, hint = "sk-…1234"): Omit<CredentialRow, "version"> => ({
  provider,
  kind: "api_key",
  hint,
  ciphertext: randomBytes(40),
  nonce: randomBytes(12),
  dekWrapped: randomBytes(48),
  dekNonce: randomBytes(12),
  keyVersion: 1,
});

async function expectUserError(p: Promise<unknown>, kind: UserErrorKind, code?: string): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(UserError);
  expect(err).toMatchObject({ kind, ...(code && { code }) });
}

export function describeStoreContract(name: string, setup: () => Promise<ContractHarness>): void {
  describe(`Store contract: ${name}`, () => {
    let h: ContractHarness | undefined;

    beforeAll(async () => {
      h = await setup();
    }, 60_000);

    afterAll(async () => {
      await h?.dispose();
    }, 300_000);

    const harness = () => {
      if (!h) throw new Error("store contract harness was not set up");
      return h;
    };
    const repos = async () => {
      const hh = harness();
      return hh.store.forUser(await hh.newUser());
    };
    const newChat = async (r: UserRepos, title?: string) => {
      const id = randomUUID();
      await r.chats.claim(id, {});
      if (title) await r.chats.touch(id, { titleIfEmpty: title });
      return id;
    };
    const newArtifact = async (r: UserRepos, title: string, chatId: string | null = null) => {
      const id = artifactId();
      await r.artifacts.insert({ id, chatId, title, sizeBytes: 100 });
      return id;
    };

    describe("factory", () => {
      it("F1: forUser throws on a non-UUID and on an upper-case UUID", () => {
        const store = harness().store;
        const id = randomUUID();
        expect(() => store.forUser("not-a-uuid")).toThrow();
        expect(() => store.forUser(id.toUpperCase())).toThrow();
        expect(store.forUser(id).userId).toBe(id);
      });
    });

    describe("profiles", () => {
      it("P1: a new user's profile reads as the empty profile", async () => {
        const r = await repos();
        expect(readStoredProfile(await r.profiles.get())).toEqual(emptyProfile());
      });

      it("P2: putData round-trips deep-equal", async () => {
        const r = await repos();
        const data = { name: "Contract", food: ["Vegan", "Thai"], nested: { list: [1, 2, { deep: "yes" }], flag: true } };
        await r.profiles.putData(data);
        expect(await r.profiles.get()).toEqual(data);
      });
    });

    describe("chats", () => {
      it("C1: claim of a new UUID makes it exist with an empty title", async () => {
        const r = await repos();
        const id = randomUUID();
        await r.chats.claim(id, {});
        expect(await r.chats.exists(id)).toBe(true);
        expect(await r.chats.get(id)).toEqual({ id, title: "", lastMessageAt: expect.any(String) });
      });

      it("C2: claim is idempotent for the owner", async () => {
        const r = await repos();
        const id = await newChat(r, "Kept");
        await r.chats.claim(id, {});
        expect(await r.chats.get(id)).toMatchObject({ id, title: "Kept" });
        expect((await r.chats.page(1)).total).toBe(1);
      });

      it("C3: claim of a non-UUID is not_found", async () => {
        const r = await repos();
        await expectUserError(r.chats.claim("not-a-uuid", {}), "not_found");
        expect((await r.chats.page(1)).total).toBe(0);
      });

      it("C4: touch sets the title once and cuts it to 200 characters", async () => {
        const r = await repos();
        const id = await newChat(r);
        await r.chats.touch(id, { titleIfEmpty: "First" });
        await r.chats.touch(id, { titleIfEmpty: "Second" });
        expect((await r.chats.get(id))?.title).toBe("First");
        const long = await newChat(r);
        await r.chats.touch(long, { titleIfEmpty: "x".repeat(TITLE_MAX + 50) });
        expect((await r.chats.get(long))?.title).toBe("x".repeat(TITLE_MAX));
      });

      it("C5: page orders by last activity, newest first, and pages past the end", async () => {
        const r = await repos();
        const ids: string[] = [];
        for (let i = 0; i <= CHATS_PAGE_SIZE; i++) {
          const id = randomUUID();
          await r.chats.claim(id, {});
          ids.push(id);
        }
        for (const id of ids) await r.chats.touch(id, {});
        const newest = [...ids].reverse();
        const one = await r.chats.page(1);
        const two = await r.chats.page(2);
        const three = await r.chats.page(3);
        expect(one.total).toBe(CHATS_PAGE_SIZE + 1);
        expect(one.items.map((c) => c.id)).toEqual(newest.slice(0, CHATS_PAGE_SIZE));
        expect(two).toEqual({ items: [expect.objectContaining({ id: newest[CHATS_PAGE_SIZE] })], total: CHATS_PAGE_SIZE + 1 });
        expect(three).toEqual({ items: [], total: CHATS_PAGE_SIZE + 1 });
        const stamps = [...one.items, ...two.items].map((c) => Date.parse(c.lastMessageAt));
        expect(stamps).toEqual([...stamps].sort((x, y) => y - x));
      });

      it("C6: titles returns only owned, valid ids", async () => {
        const r = await repos();
        const named = await newChat(r, "One");
        const blank = await newChat(r);
        const titles = await r.chats.titles([named, blank, "not-a-uuid", randomUUID()]);
        expect(titles).toEqual(
          new Map([
            [named, "One"],
            [blank, ""],
          ]),
        );
        expect(await r.chats.titles([])).toEqual(new Map());
      });

      it("C7: get of a non-UUID is undefined", async () => {
        const r = await repos();
        expect(await r.chats.get("not-a-uuid")).toBeUndefined();
        expect(await r.chats.get(randomUUID())).toBeUndefined();
      });
    });

    describe("messages", () => {
      it("M1: append then history returns messages oldest to newest with parts and status", async () => {
        const r = await repos();
        const chat = await newChat(r);
        const parts = [
          { type: "text" as const, text: "Here you go" },
          { type: "tool" as const, id: "t1", name: "research", args: '{"q":"x"}', result: "done" },
        ];
        await r.messages.append(chat, "run-1", [
          message("hello"),
          message("Here you go", { role: "assistant", status: "interrupted", parts }),
        ]);
        await r.messages.append(chat, "run-2", [message("again")]);
        const history = await r.messages.history(chat);
        expect(history.total).toBe(3);
        expect(history.items).toEqual([
          { role: "user", content: "hello", status: "complete", createdAt: expect.any(String) },
          { role: "assistant", content: "Here you go", status: "interrupted", createdAt: expect.any(String), parts },
          { role: "user", content: "again", status: "complete", createdAt: expect.any(String) },
        ]);
        expect(history.items[0]).not.toHaveProperty("parts");
      });

      it("M2: history with a limit returns the newest n in chronological order", async () => {
        const r = await repos();
        const chat = await newChat(r);
        for (const n of [1, 2, 3, 4, 5]) await r.messages.append(chat, `run-${n}`, [message(`m${n}`)]);
        const history = await r.messages.history(chat, 3);
        expect(history.total).toBe(5);
        expect(history.items.map((m) => m.content)).toEqual(["m3", "m4", "m5"]);
      });

      it("M3: append of no rows is a no-op", async () => {
        const r = await repos();
        const chat = await newChat(r);
        await r.messages.append(chat, "run-1", []);
        await r.messages.append(randomUUID(), "run-1", []);
        expect(await r.messages.history(chat)).toEqual({ items: [], total: 0 });
      });
    });

    describe("artifacts", () => {
      it("A1: insert, get, summary and page work, newest first, with titles cut to 200 characters", async () => {
        const r = await repos();
        const chat = await newChat(r);
        const ids: string[] = [];
        for (let i = 0; i <= REPORTS_PAGE_SIZE; i++) ids.push(await newArtifact(r, `Report ${i}`, i === 0 ? chat : null));
        expect(await r.artifacts.get(ids[0]!)).toEqual({ id: ids[0], chatId: chat, title: "Report 0", pdfReady: false, thumbReady: false });
        expect(await r.artifacts.summary(ids[1]!)).toEqual({
          id: ids[1],
          chatId: null,
          title: "Report 1",
          pdfReady: false,
          sizeBytes: 100,
          createdAt: expect.any(String),
        });
        const newest = [...ids].reverse();
        const one = await r.artifacts.page(1);
        const two = await r.artifacts.page(2);
        expect(one.total).toBe(REPORTS_PAGE_SIZE + 1);
        expect(one.items.map((a) => a.id)).toEqual(newest.slice(0, REPORTS_PAGE_SIZE));
        expect(two.items.map((a) => a.id)).toEqual([ids[0]]);
        expect(two.total).toBe(REPORTS_PAGE_SIZE + 1);
        const long = await newArtifact(r, "y".repeat(TITLE_MAX + 20));
        expect((await r.artifacts.get(long))?.title).toBe("y".repeat(TITLE_MAX));
      });

      it("A2: an invalid id is not_found on insert and undefined on get", async () => {
        const r = await repos();
        await expectUserError(r.artifacts.insert({ id: "bad id!", chatId: null, title: "Bad", sizeBytes: 100 }), "not_found");
        expect(await r.artifacts.get("bad id!")).toBeUndefined();
        expect((await r.artifacts.page(1)).total).toBe(0);
      });

      it("A3: setPdf marks the pdf ready and setThumb reports whether the artifact is the user's", async () => {
        const r = await repos();
        const id = await newArtifact(r, "Ready");
        await r.artifacts.setPdf(id);
        expect(await r.artifacts.get(id)).toMatchObject({ pdfReady: true, thumbReady: false });
        expect((await r.artifacts.summary(id))?.pdfReady).toBe(true);
        expect(await r.artifacts.setThumb(id)).toBe(true);
        expect((await r.artifacts.get(id))?.thumbReady).toBe(true);
        expect(await r.artifacts.setThumb(artifactId())).toBe(false);
      });
    });

    describe("search", () => {
      const zebraUser = async () => {
        const r = await repos();
        const titled = await newChat(r, "Trip to ZEBRA island");
        const messaged = await newChat(r, "Groceries");
        await r.messages.append(messaged, "run-1", [message("We saw a zebra at the zoo")]);
        const report = await newArtifact(r, "Zebra report");
        await newChat(r, "Unrelated");
        return { r, titled, messaged, report };
      };

      it("S1: title and message matches return the right kind, match and counts, case-insensitively", async () => {
        const { r, titled, messaged, report } = await zebraUser();
        const res = await r.search.search("zEbRa", "all", 1);
        expect(res).toMatchObject({ total: 3, chats: 2, reports: 1 });
        const byRef = new Map(res.items.map((i) => [i.refId, i]));
        expect(byRef.get(titled)).toMatchObject({ kind: "chat", match: "title", chatId: titled, title: "Trip to ZEBRA island" });
        expect(byRef.get(messaged)).toMatchObject({ kind: "chat", match: "message", chatId: messaged, title: "Groceries" });
        expect(byRef.get(report)).toMatchObject({ kind: "report", match: "title", chatId: null, snippet: null, contentLength: null });
        expect(res.items).toHaveLength(3);
      });

      it("S2: scope filters the items but not the counts", async () => {
        const { r, report } = await zebraUser();
        const chats = await r.search.search("zebra", "chats", 1);
        expect(chats).toMatchObject({ total: 2, chats: 2, reports: 1 });
        expect(chats.items.every((i) => i.kind === "chat")).toBe(true);
        const reports = await r.search.search("zebra", "reports", 1);
        expect(reports).toMatchObject({ total: 1, chats: 2, reports: 1 });
        expect(reports.items.map((i) => i.refId)).toEqual([report]);
      });

      it("S3: a message match has a snippet with the needle and the message length", async () => {
        const r = await repos();
        const chat = await newChat(r, "Plain");
        const content = `${"a".repeat(150)} the hidden NeEdLe sits here ${"b".repeat(300)}`;
        await r.messages.append(chat, "run-1", [message(content)]);
        const [hit] = (await r.search.search("needle", "all", 1)).items;
        expect(hit).toMatchObject({ kind: "chat", refId: chat, match: "message", contentLength: content.length });
        expect(hit?.snippet?.toLowerCase()).toContain("needle");
        expect(hit?.snippetStart).toEqual(expect.any(Number));
      });

      it("S4: queries outside the allowed length are invalid", async () => {
        const r = await repos();
        await newChat(r, "Length check");
        await expectUserError(r.search.search("a", "all", 1), "invalid");
        await expectUserError(r.search.search("x".repeat(SEARCH_MAX + 1), "all", 1), "invalid");
        expect((await r.search.search("l".repeat(SEARCH_MIN), "all", 1)).total).toBe(0);
        expect((await r.search.search("l".repeat(SEARCH_MAX), "all", 1)).total).toBe(0);
      });

      it("S5: results page by SEARCH_PAGE_SIZE, newest first", async () => {
        const r = await repos();
        const ids: string[] = [];
        for (let i = 0; i <= SEARCH_PAGE_SIZE; i++) ids.push(await newChat(r, `Paging walrus ${i}`));
        const one = await r.search.search("walrus", "all", 1);
        const two = await r.search.search("walrus", "all", 2);
        expect(one.total).toBe(SEARCH_PAGE_SIZE + 1);
        expect(two.total).toBe(SEARCH_PAGE_SIZE + 1);
        expect([...one.items, ...two.items].map((i) => i.refId)).toEqual([...ids].reverse());
        expect(one.items).toHaveLength(SEARCH_PAGE_SIZE);
      });

      it("S6: % and _ in the query match literally", async () => {
        const r = await repos();
        const percent = await newChat(r, "growth 50% more");
        await newChat(r, "growth 50x more");
        const underscore = await newChat(r, "snake_case names");
        await newChat(r, "snakeXcase names");
        expect((await r.search.search("50%", "all", 1)).items.map((i) => i.refId)).toEqual([percent]);
        expect((await r.search.search("e_c", "all", 1)).items.map((i) => i.refId)).toEqual([underscore]);
      });
    });

    describe("storage", () => {
      const FILES = {
        html: Buffer.from("<!doctype html><p>contract</p>"),
        pdf: Buffer.from("%PDF-1.4 contract"),
        jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
      };

      it("ST1: upload and download round-trip html, pdf and jpg", async () => {
        const r = await repos();
        const id = artifactId();
        for (const [file, bytes] of Object.entries(FILES) as Array<[keyof typeof FILES, Buffer]>) {
          await r.storage.upload(id, file, bytes);
          expect((await r.storage.download(id, file))?.equals(bytes)).toBe(true);
        }
      });

      it("ST2: a missing object downloads as undefined", async () => {
        const r = await repos();
        expect(await r.storage.download(artifactId(), "pdf")).toBeUndefined();
      });

      it("ST3: remove then download is undefined", async () => {
        const r = await repos();
        const id = artifactId();
        await r.storage.upload(id, "html", FILES.html);
        await r.storage.remove(id, "html");
        expect(await r.storage.download(id, "html")).toBeUndefined();
      });

      it("ST4: a second html upload rejects; a second pdf or jpg upload replaces the first", async () => {
        const r = await repos();
        const id = artifactId();
        await r.storage.upload(id, "html", FILES.html);
        await expect(r.storage.upload(id, "html", Buffer.from("<p>other</p>"))).rejects.toBeInstanceOf(UserError);
        expect((await r.storage.download(id, "html"))?.equals(FILES.html)).toBe(true);
        for (const file of ["pdf", "jpg"] as const) {
          const next = Buffer.concat([FILES[file], Buffer.from("-v2")]);
          await r.storage.upload(id, file, FILES[file]);
          await r.storage.upload(id, file, next);
          expect((await r.storage.download(id, file))?.equals(next)).toBe(true);
        }
      });
    });

    describe("provider settings", () => {
      it("PS1: the first get returns the defaults with a device id and a stamp", async () => {
        const r = await repos();
        const first = await r.providerSettings.get();
        expect(first).toEqual({ data: DEFAULT_SETTINGS, deviceId: expect.any(String), stamp: expect.any(String) });
        expect(await r.providerSettings.get()).toEqual(first);
      });

      it("PS2: put with the current stamp returns a new stamp and stores the data", async () => {
        const r = await repos();
        const { stamp, deviceId } = await r.providerSettings.get();
        const data = { custom: {}, enabled: { openai: true }, hidden: ["x"] };
        const next = await r.providerSettings.put(data, stamp);
        expect(next).not.toBe(stamp);
        expect(await r.providerSettings.get()).toEqual({ data, deviceId, stamp: next });
      });

      it("PS3: put with a stale stamp is a settings_changed conflict", async () => {
        const r = await repos();
        const { stamp } = await r.providerSettings.get();
        const next = await r.providerSettings.put({ custom: {}, enabled: {}, hidden: ["a"] }, stamp);
        await expectUserError(r.providerSettings.put({ custom: {}, enabled: {}, hidden: ["b"] }, stamp), "conflict", "settings_changed");
        expect(await r.providerSettings.get()).toMatchObject({ data: { hidden: ["a"] }, stamp: next });
      });
    });

    describe("credentials", () => {
      it("CR1: insert, read and list work, sorted by provider, with byte-equal buffers", async () => {
        const r = await repos();
        const openai = credential("openai", "sk-…open");
        const anthropic = credential("anthropic", "sk-…anth");
        await r.credentials.insert(openai);
        await r.credentials.insert(anthropic);
        const read = await r.credentials.read("openai");
        expect(read).toEqual({ ...openai, version: 1 });
        for (const k of ["ciphertext", "nonce", "dekWrapped", "dekNonce"] as const) expect(read?.[k].equals(openai[k])).toBe(true);
        expect(await r.credentials.list()).toEqual([
          { provider: "anthropic", kind: "api_key", hint: "sk-…anth" },
          { provider: "openai", kind: "api_key", hint: "sk-…open" },
        ]);
        expect(await r.credentials.read("groq")).toBeUndefined();
      });

      it("CR2: a duplicate insert is a conflict", async () => {
        const r = await repos();
        await r.credentials.insert(credential("openai"));
        await expectUserError(r.credentials.insert(credential("openai")), "conflict");
      });

      it("CR3: update succeeds with the current version and fails with a stale one", async () => {
        const r = await repos();
        await r.credentials.insert(credential("openai"));
        const second = credential("openai", "sk-…two2");
        expect(await r.credentials.update(second, 1)).toBe(true);
        expect(await r.credentials.read("openai")).toEqual({ ...second, version: 2 });
        expect(await r.credentials.update(credential("openai", "sk-…bad3"), 1)).toBe(false);
        expect(await r.credentials.read("openai")).toEqual({ ...second, version: 2 });
      });

      it("CR4: delete removes the credential", async () => {
        const r = await repos();
        await r.credentials.insert(credential("openai"));
        await r.credentials.delete("openai");
        expect(await r.credentials.read("openai")).toBeUndefined();
        expect(await r.credentials.list()).toEqual([]);
      });
    });

    describe("isolation matrix", () => {
      const WORD = `quokka${randomUUID().slice(0, 8)}`;
      const A_SETTINGS = { custom: {}, enabled: { openai: true }, hidden: ["secret"] };
      const A_PROFILE = { name: "Alice Contract", food: ["Vegan"] };
      const A_HTML = Buffer.from("<p>alice only</p>");
      let a: UserRepos;
      let b: UserRepos;
      let chat: string;
      let blankChat: string;
      let artifact: string;
      let credentialRow: Omit<CredentialRow, "version">;
      let settingsStamp: string;

      beforeAll(async () => {
        a = await repos();
        b = await repos();
        chat = await newChat(a, `Alpha ${WORD} plans`);
        blankChat = await newChat(a);
        await a.messages.append(chat, "run-a", [message(`the ${WORD} is private`)]);
        artifact = await newArtifact(a, `Report ${WORD}`, chat);
        await a.storage.upload(artifact, "html", A_HTML);
        settingsStamp = await a.providerSettings.put(A_SETTINGS, (await a.providerSettings.get()).stamp);
        credentialRow = credential("openai", "sk-…alic");
        await a.credentials.insert(credentialRow);
        await a.profiles.putData(A_PROFILE);
      }, 120_000);

      it("ISO1: B's chat list, get, exists and titles show none of A's chats", async () => {
        expect(await b.chats.page(1)).toEqual({ items: [], total: 0 });
        expect(await b.chats.get(chat)).toBeUndefined();
        expect(await b.chats.exists(chat)).toBe(false);
        expect(await b.chats.titles([chat, blankChat])).toEqual(new Map());
      });

      it("ISO2: B's claim of A's chat is not_found and A's chat is unchanged", async () => {
        const before = await a.chats.get(chat);
        await expectUserError(b.chats.claim(chat, {}), "not_found");
        expect(await a.chats.get(chat)).toEqual(before);
        expect(await b.chats.exists(chat)).toBe(false);
      });

      it("ISO3: B's touch of A's chat changes nothing for A", async () => {
        const before = await a.chats.get(blankChat);
        await b.chats.touch(blankChat, { titleIfEmpty: "hijacked" });
        expect(await a.chats.get(blankChat)).toEqual(before);
      });

      it("ISO4: B's append to A's chat is not_found and adds nothing for either user", async () => {
        await expectUserError(b.messages.append(chat, "run-b", [message("intrusion")]), "not_found");
        expect((await a.messages.history(chat)).total).toBe(1);
        expect((await b.messages.history(chat)).total).toBe(0);
      });

      it("ISO5: B's history of A's chat is empty", async () => {
        expect(await b.messages.history(chat)).toEqual({ items: [], total: 0 });
      });

      it("ISO6: B's artifact get, summary and page exclude A's, and setThumb on A's is false", async () => {
        expect(await b.artifacts.get(artifact)).toBeUndefined();
        expect(await b.artifacts.summary(artifact)).toBeUndefined();
        expect(await b.artifacts.page(1)).toEqual({ items: [], total: 0 });
        expect(await b.artifacts.setThumb(artifact)).toBe(false);
        expect((await a.artifacts.get(artifact))?.thumbReady).toBe(false);
      });

      it("ISO7: B's artifact insert with A's chat id is not_found", async () => {
        await expectUserError(b.artifacts.insert({ id: artifactId(), chatId: chat, title: "Sneaky", sizeBytes: 100 }), "not_found");
        expect((await b.artifacts.page(1)).total).toBe(0);
        expect((await a.artifacts.page(1)).total).toBe(1);
      });

      it("ISO8: B's search for A's unique word finds nothing", async () => {
        expect((await b.search.search(WORD, "all", 1)).total).toBe(0);
        expect((await a.search.search(WORD, "all", 1)).total).toBe(2);
      });

      it("ISO9: B's download of A's artifact is undefined", async () => {
        expect(await b.storage.download(artifact, "html")).toBeUndefined();
        expect((await a.storage.download(artifact, "html"))?.equals(A_HTML)).toBe(true);
      });

      it("ISO10: B gets its own default settings and B's put leaves A's settings unchanged", async () => {
        const mine = await b.providerSettings.get();
        expect(mine.data).toEqual(DEFAULT_SETTINGS);
        await b.providerSettings.put({ custom: {}, enabled: { groq: true }, hidden: [] }, mine.stamp);
        expect(await a.providerSettings.get()).toMatchObject({ data: A_SETTINGS, stamp: settingsStamp });
      });

      it("ISO11: B cannot read, list, update or delete A's credentials", async () => {
        expect(await b.credentials.read("openai")).toBeUndefined();
        expect(await b.credentials.list()).toEqual([]);
        expect(await b.credentials.update(credential("openai", "sk-…evil"), 1)).toBe(false);
        await b.credentials.delete("openai");
        expect(await a.credentials.read("openai")).toEqual({ ...credentialRow, version: 1 });
      });

      it("ISO12: profiles stay separate", async () => {
        expect(readStoredProfile(await b.profiles.get())).toEqual(emptyProfile());
        await b.profiles.putData({ name: "Bob Contract" });
        expect(await a.profiles.get()).toEqual(A_PROFILE);
        expect(await b.profiles.get()).toEqual({ name: "Bob Contract" });
      });
    });
  });
}
