import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import { LegalPage } from "@/components/legal/LegalPage";
import { LEGAL_DOCS, LEGAL_DRAFT_MARKER, loadLegal, parseLegal } from "@/lib/legal";
import { decideRoute } from "@/lib/routeRules";
import { expectUniqueIds } from "../../../../packages/ui/test/support/ids.ts";

vi.mock("next/link", async () => (await import("../support/link")).linkMock());

const CONTENT = join(import.meta.dirname, "../../content");
const TOMBSTONE =
  "When you delete your account we keep a peppered hash of your email and that month's request count, for up to 2 months, so deleting and re-joining doesn't reset limits.";

describe("parseLegal", () => {
  it("reads the title, headings, paragraphs and lists, and drops HTML comments", () => {
    const doc = parseLegal("<!-- note -->\n# Title\n\nFirst line\nwraps here.\n\n## Part\n- one\n- two\n\n### Small\nEnd.\n");
    expect(doc).toEqual({
      title: "Title",
      draft: false,
      blocks: [
        { kind: "p", text: "First line wraps here." },
        { kind: "h2", text: "Part" },
        { kind: "ul", items: ["one", "two"] },
        { kind: "h3", text: "Small" },
        { kind: "p", text: "End." },
      ],
    });
  });

  it("marks a draft while the marker is present, and needs a title", () => {
    expect(parseLegal(`<!-- ${LEGAL_DRAFT_MARKER} -->\n# T\n`).draft).toBe(true);
    expect(() => parseLegal("no title")).toThrow("# Title");
  });
});

describe("the Terms and Privacy drafts", () => {
  it.each(LEGAL_DOCS)("%s.md starts with the draft marker the configure-auth open check looks for", (name) => {
    expect(readFileSync(join(CONTENT, `${name}.md`), "utf8").startsWith(`<!-- ${LEGAL_DRAFT_MARKER} -->`)).toBe(true);
    expect(loadLegal(name, CONTENT).draft).toBe(true);
  });

  it("the Privacy draft names the deletion record", () => {
    const text = loadLegal("privacy", CONTENT)
      .blocks.map((b) => (b.kind === "ul" ? b.items.join(" ") : b.text))
      .join(" ");
    expect(text).toContain(TOMBSTONE);
  });
});

describe("the /terms and /privacy pages", () => {
  it.each([
    ["terms", TermsPage, "Terms of Service", "/privacy"],
    ["privacy", PrivacyPage, "Privacy Policy", "/terms"],
  ] as const)("/%s renders the content with the draft banner and unique ids", (id, Page, title, other) => {
    const { container } = render(<Page />);
    expect(container.querySelector(`#${id}-title`)?.textContent).toBe(title);
    expect(container.querySelector("#legal-draft-banner")?.textContent).toContain("Draft, not reviewed yet.");
    expect(container.querySelector(`#${id}-other`)?.getAttribute("href")).toBe(other);
    expect(container.querySelector(`#${id}-home`)?.getAttribute("href")).toBe("/");
    expect(container.querySelectorAll(`[id^='${id}-block-']`).length).toBeGreaterThan(5);
    expectUniqueIds(container);
  });

  it("shows no banner once the marker is gone", () => {
    const { container } = render(<LegalPage id="terms" doc={parseLegal("# Terms of Service\n\nApproved text.\n")} />);
    expect(container.querySelector("#legal-draft-banner")).toBeNull();
    expect(container.querySelector("#terms-block-1")?.textContent).toBe("Approved text.");
  });

  it("are public: signed-out visitors get the page, not the login redirect", () => {
    for (const path of ["/terms", "/privacy"]) {
      expect(decideRoute(path, { user: null, unavailable: false })).toEqual({ kind: "pass" });
      expect(decideRoute(path, { user: null, unavailable: true })).toEqual({ kind: "pass" });
    }
  });
});
