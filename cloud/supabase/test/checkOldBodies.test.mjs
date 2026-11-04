import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BODIES_QUERY, compareBodies, FUNCTIONS, headerAttributes, ROLLBACK, rollbackBodies } from "../scripts/check-old-bodies.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-old-bodies.mjs", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));
const run = (input, args = []) => spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8" });

const bodyIn = (file, name) => {
  const sql = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const at = sql.indexOf(`create function ${name}(`);
  const open = sql.indexOf("$$", at) + 2;
  return sql.slice(open, sql.indexOf("$$", open));
};

const SRC = {
  "private.handle_new_user()": bodyIn("20261101060619_profiles.sql", "private.handle_new_user"),
  "private.before_user_created(jsonb)": bodyIn("20261101060633_access.sql", "private.before_user_created"),
};
const OLD = {
  "private.handle_new_user()": {
    prosrc: SRC["private.handle_new_user()"],
    prosecdef: true,
    provolatile: "v",
    proconfig: ['search_path=""'],
  },
  "private.before_user_created(jsonb)": {
    prosrc: SRC["private.before_user_created(jsonb)"],
    prosecdef: false,
    provolatile: "s",
    proconfig: ['search_path=""'],
  },
};
const HNU = "private.handle_new_user()";

describe("check-old-bodies.mjs (Gate 8 step: live bodies match rollback/m7.sql)", () => {
  it("parses both function bodies from rollback/m7.sql, equal to the migrations that created them", () => {
    assert.deepEqual(FUNCTIONS, ["private.handle_new_user()", "private.before_user_created(jsonb)"]);
    assert.ok(ROLLBACK.endsWith("cloud/supabase/rollback/m7.sql"));
    const bodies = rollbackBodies();
    assert.deepEqual(Object.keys(bodies).sort(), [...FUNCTIONS].sort());
    for (const f of FUNCTIONS) {
      assert.ok(SRC[f].includes("begin"), f);
      assert.equal(bodies[f].prosrc, SRC[f], f);
    }
    assert.deepEqual(
      { ...bodies[HNU], prosrc: undefined },
      { prosrc: undefined, prosecdef: true, provolatile: "v", proconfig: ["search_path="] },
    );
    assert.deepEqual(
      { ...bodies["private.before_user_created(jsonb)"], prosrc: undefined },
      { prosrc: undefined, prosecdef: false, provolatile: "s", proconfig: ["search_path="] },
    );
  });

  it("reads security definer, volatility and set clauses from a function header", () => {
    assert.deepEqual(headerAttributes("\nreturns trigger language plpgsql security definer set search_path = '' "), {
      prosecdef: true,
      provolatile: "v",
      proconfig: ["search_path="],
    });
    assert.deepEqual(headerAttributes(" returns int language sql immutable "), { prosecdef: false, provolatile: "i", proconfig: null });
    assert.deepEqual(headerAttributes(" language sql stable SET search_path TO 'public' "), {
      prosecdef: false,
      provolatile: "s",
      proconfig: ["search_path=public"],
    });
  });

  it("the query is one read-only select that returns a JSON object of prosrc, prosecdef, provolatile and proconfig by signature", () => {
    assert.match(
      BODIES_QUERY,
      /^select json_object_agg\(p\.oid::regprocedure::text, json_build_object\('prosrc', p\.prosrc, 'prosecdef', p\.prosecdef, 'provolatile', p\.provolatile, 'proconfig', p\.proconfig\)\) from pg_proc p where p\.oid in \(/,
    );
    for (const f of FUNCTIONS) assert.ok(BODIES_QUERY.includes(`'${f}'::regprocedure`), f);
    assert.doesNotMatch(BODIES_QUERY, /\b(insert|update|delete|drop|alter|create|grant|revoke)\b/i);
    const q = run("", ["--query"]);
    assert.equal(q.status, 0);
    assert.equal(q.stdout, `${BODIES_QUERY}\n`);
  });

  it("exits 0 when both live bodies match, naming each function", () => {
    assert.deepEqual(compareBodies(OLD).problems, []);
    const r = run(`${JSON.stringify(OLD)}\n`);
    assert.equal(r.status, 0, r.stderr);
    for (const f of FUNCTIONS) assert.match(r.stdout, new RegExp(`${f.replace(/[()]/g, "\\$&")} matches rollback/m7\\.sql`));
  });

  it("exits 1 when a body differs (the M7 body after the push, or a hand edit on live), without printing the bodies", () => {
    const m7 = { ...OLD, [HNU]: { ...OLD[HNU], prosrc: `${SRC[HNU]}  perform 1;\n` } };
    const r = run(JSON.stringify(m7));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /private\.handle_new_user\(\) differs from rollback\/m7\.sql \(prosrc\)/);
    assert.match(r.stderr, /STOP/);
    assert.ok(!r.stderr.includes("perform 1"));
    assert.ok(!r.stderr.includes("invited_emails"));
  });

  it("exits 1 when security definer, volatility or a set clause differs, naming the attribute", () => {
    for (const [change, attr] of [
      [{ prosecdef: false }, "prosecdef"],
      [{ provolatile: "s" }, "provolatile"],
      [{ proconfig: null }, "proconfig"],
      [{ proconfig: ["search_path=public"] }, "proconfig"],
      [{ proconfig: ['search_path=""', "work_mem=64MB"] }, "proconfig"],
    ]) {
      const r = run(JSON.stringify({ ...OLD, [HNU]: { ...OLD[HNU], ...change } }));
      assert.equal(r.status, 1, attr);
      assert.match(r.stderr, new RegExp(`private\\.handle_new_user\\(\\) differs from rollback/m7\\.sql \\(${attr}\\)`), attr);
    }
    assert.deepEqual(compareBodies({ ...OLD, [HNU]: { ...OLD[HNU], proconfig: ["search_path="] } }).problems, []);
  });

  it("exits 2 for a missing function, malformed input or an unknown option", () => {
    const one = { [HNU]: OLD[HNU] };
    const missing = run(JSON.stringify(one));
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /private\.before_user_created\(jsonb\) is missing/);
    assert.equal(run("").status, 2);
    assert.equal(run("not json").status, 2);
    assert.equal(run("[]").status, 2);
    const bare = run(JSON.stringify({ ...OLD, [HNU]: SRC[HNU] }));
    assert.equal(bare.status, 2);
    assert.match(bare.stderr, /lacks prosrc, prosecdef, provolatile, proconfig/);
    assert.equal(run(JSON.stringify(OLD), ["--db-url"]).status, 2);
  });
});
