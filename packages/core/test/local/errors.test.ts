import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { UserError } from "../../src/lib/errors.js";
import { sqliteError, StoreOpenError } from "../../src/local/store/errors.js";

const kindOf = (err: unknown) => sqliteError("test", err).kind;

function failure(sql: string): unknown {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`CREATE TABLE p (id TEXT NOT NULL PRIMARY KEY, u TEXT UNIQUE, n TEXT NOT NULL DEFAULT 'x', c INTEGER CHECK (c > 0)) STRICT;
           CREATE TABLE k (pid TEXT REFERENCES p(id)) STRICT;
           INSERT INTO p (id, u) VALUES ('a', 'u');`);
  try {
    db.exec(sql);
  } catch (e) {
    return e;
  } finally {
    db.close();
  }
  throw new Error(`no failure for ${sql}`);
}

describe("sqliteError", () => {
  it.each([
    ["primary key", "INSERT INTO p (id) VALUES ('a')", "conflict"],
    ["unique", "INSERT INTO p (id, u) VALUES ('b', 'u')", "conflict"],
    ["foreign key", "INSERT INTO k VALUES ('missing')", "not_found"],
    ["check", "INSERT INTO p (id, c) VALUES ('c', 0)", "invalid"],
    ["not null", "INSERT INTO p (id, n) VALUES ('d', NULL)", "invalid"],
    ["strict type", "INSERT INTO p (id, c) VALUES ('e', 'text')", "invalid"],
    ["anything else", "SELECT * FROM nope", "upstream"],
  ])("maps a real %s failure", (_name, sql, kind) => {
    const err = sqliteError("test", failure(sql));
    expect(err).toBeInstanceOf(UserError);
    expect(err.kind).toBe(kind);
  });

  it("maps busy codes to unavailable and unknown errors to upstream", () => {
    expect(kindOf(Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR", errcode: 5 }))).toBe("unavailable");
    expect(kindOf(Object.assign(new Error("busy snapshot"), { code: "ERR_SQLITE_ERROR", errcode: 517 }))).toBe("unavailable");
    expect(kindOf(new Error("boom"))).toBe("upstream");
    expect(kindOf("not an error")).toBe("upstream");
  });

  it("never puts values in the user message", () => {
    const err = sqliteError("test", failure("INSERT INTO p (id, u) VALUES ('secret-value', 'u')"));
    expect(err.message).not.toContain("secret-value");
    expect(err.message).not.toContain("p.u");
  });
});

describe("StoreOpenError", () => {
  it("carries a refusal code", () => {
    const err = new StoreOpenError("db_newer", "written by a newer Open Agent");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("db_newer");
    expect(err.message).toContain("newer Open Agent");
  });
});
