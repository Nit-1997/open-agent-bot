import { afterAll, describe, expect, it } from "vitest";
import { biomeFixtures } from "./biomeFixture.js";

const { lint, dispose } = biomeFixtures("no-cloud-");

afterAll(dispose);

const blocked = [
  'import x from "../../../cloud/agent/store.ts";\nexport default x;\n',
  'export const load = () => import("../../cloud/web/x");\n',
  'export * from "../cloud/x";\n',
  'import x from "@oab/cloud";\nexport default x;\n',
  'import x from "@oab/cloud/agent";\nexport default x;\n',
];

const allowed = [
  'import x from "@google-cloud/storage";\nexport default x;\n',
  'import x from "./cloudinary.ts";\nexport default x;\n',
  'import x from "../clouds/x";\nexport default x;\n',
  'export const load = () => import("@google-cloud/storage");\n',
];

describe("no imports from cloud/", () => {
  it.each(blocked)("blocks %s in packages/core", (code) => {
    const r = lint("core", "src/http/fixture.ts", code);
    expect(r.out).toContain("lint/style/noRestrictedImports");
    expect(r.out).toContain("Nothing outside cloud/ may import from cloud/.");
    expect(r.status).not.toBe(0);
  });

  it.each(allowed)("allows %s", (code) => {
    const r = lint("core", "src/http/fixture.ts", code);
    expect(r.out).not.toContain("noRestrictedImports");
    expect(r.status).toBe(0);
  });

  it("blocks cloud imports in packages/shared/src too", () => {
    const r = lint("shared", "src/fixture.ts", 'import x from "../../cloud/agent/store.ts";\nexport default x;\n');
    expect(r.out).toContain("lint/style/noRestrictedImports");
    expect(r.status).not.toBe(0);
  });
});
