import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keepInternals, localTypesArgs, main, OUT } from "../scripts/gen-types.mjs";
import { Refusal } from "../scripts/local-stack.mjs";

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:18742/postgres";
const refuses = (fn, re) => assert.throws(fn, (e) => e instanceof Refusal && re.test(e.message));

describe("gen-types.mjs --local", () => {
  it("generates from the local stack database only, with TLS off", () => {
    assert.deepEqual(localTypesArgs({ OAB_SB_DB_URL: LOCAL }), [
      "gen",
      "types",
      "--lang",
      "typescript",
      "--db-url",
      `${LOCAL}?sslmode=disable`,
      "--schema",
      "public",
    ]);
  });

  it("refuses a database that isn't 127.0.0.1 on a factory port", () => {
    refuses(() => localTypesArgs({}), /needs OAB_SB_DB_URL/);
    refuses(() => localTypesArgs({ OAB_SB_DB_URL: "postgresql://postgres:pw@db.example.com:5432/postgres" }), /host must be 127\.0\.0\.1/);
    refuses(() => localTypesArgs({ OAB_SB_DB_URL: "postgresql://postgres:pw@localhost:18742/postgres" }), /host must be 127\.0\.0\.1/);
    refuses(() => localTypesArgs({ OAB_SB_DB_URL: "postgresql://postgres:pw@127.0.0.1:5432/postgres" }), /port must be 18700-18749/);
    refuses(() => localTypesArgs({ OAB_SB_DB_URL: "https://127.0.0.1:18742" }), /postgresql:\/\//);
    refuses(() => localTypesArgs({ OAB_SB_DB_URL: `${LOCAL}?host=db.example.com` }), /got host\)/);
    refuses(() => localTypesArgs({ OAB_SB_DB_URL: `${LOCAL}?hostaddr=10.0.0.1` }), /got hostaddr\)/);
  });

  it("refuses to run with live Supabase credentials in the environment", () => {
    for (const k of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "SUPABASE_DB_PASSWORD", "SUPABASE_DB_URL"])
      refuses(() => localTypesArgs({ OAB_SB_DB_URL: LOCAL, [k]: "x" }), new RegExp(k));
  });

  it("writes the CLI output to the agent's database types and never calls the network", async () => {
    const calls = [];
    const writes = [];
    const code = await main(["--local"], {
      env: { OAB_SB_DB_URL: LOCAL },
      run: (bin, args) => {
        calls.push([bin, ...args]);
        return { status: 0, stdout: "export type Database = {}\n", stderr: "" };
      },
      write: (file, text) => writes.push([file, text]),
      out: () => {},
      previous: () => undefined,
    });
    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "supabase");
    assert.equal(calls[0].includes("--linked") || calls[0].includes("--project-id"), false);
    assert.deepEqual(writes, [[OUT, "export type Database = {}\n"]]);
    assert.match(OUT, /cloud\/agent\/src\/store\/database\.types\.ts$/);
  });

  it("fails without writing when the CLI fails or prints no types", async () => {
    for (const res of [
      { status: 1, stdout: "", stderr: "boom" },
      { status: 0, stdout: "nothing", stderr: "" },
    ]) {
      const writes = [];
      await assert.rejects(
        main(["--local"], {
          env: { OAB_SB_DB_URL: LOCAL },
          run: () => res,
          write: (...a) => writes.push(a),
          out: () => {},
          previous: () => undefined,
        }),
        /supabase gen types failed/,
      );
      assert.equal(writes.length, 0);
    }
  });

  it("keeps the PostgREST version block the database URL output lacks", () => {
    const previous = [
      "export type Database = {",
      "  // Allows to automatically instantiate createClient with right options",
      "  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)",
      "  __InternalSupabase: {",
      '    PostgrestVersion: "14.18"',
      "  }",
      "  public: {}",
      "}",
      "",
    ].join("\n");
    const generated = 'export type Database = {\n  public: { x: 1 }\n}\ntype W = Omit<Database, "__InternalSupabase">\n';
    const kept = keepInternals(generated, previous);
    assert.match(
      kept,
      /^export type Database = \{\n {2}\/\/ Allows[^\n]*\n[^\n]*\n {2}__InternalSupabase: \{\n {4}PostgrestVersion: "14\.18"\n {2}\}\n {2}public: \{ x: 1 \}/,
    );
    assert.equal(keepInternals(kept, previous), kept);
    assert.equal(keepInternals(generated, undefined), generated);
  });

  it("accepts no other arguments", async () => {
    await assert.rejects(main(["--linked"], { env: {} }), (e) => e instanceof Refusal);
    await assert.rejects(main(["--local", "--x"], { env: {} }), (e) => e instanceof Refusal);
  });
});
