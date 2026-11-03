import { describe, expect, it } from "vitest";
import { downloadDecision, permissionDecision } from "../src/main/permissions.ts";

const O = "http://127.0.0.1:18420";

describe("permissionDecision (D4)", () => {
  it("allows only clipboard-sanitized-write for the app origin", () => {
    expect(permissionDecision("clipboard-sanitized-write", O, O)).toBe(true);
    expect(permissionDecision("clipboard-sanitized-write", `${O}/chats/1`, O)).toBe(true);
  });

  const denied: [string, string | undefined, string | undefined][] = [
    ["clipboard-sanitized-write", "http://localhost:18420", O],
    ["clipboard-sanitized-write", "https://example.com", O],
    ["clipboard-sanitized-write", O, undefined],
    ["clipboard-sanitized-write", undefined, O],
    ["clipboard-sanitized-write", "oa-shell://screens", O],
    ["clipboard-read", O, O],
    ["notifications", O, O],
    ["geolocation", O, O],
    ["media", O, O],
    ["midi", O, O],
    ["midiSysex", O, O],
    ["fullscreen", O, O],
    ["openExternal", O, O],
    ["pointerLock", O, O],
    ["hid", O, O],
    ["serial", O, O],
    ["usb", O, O],
    ["display-capture", O, O],
    ["idle-detection", O, O],
    ["window-management", O, O],
    ["unknown", O, O],
  ];
  for (const [p, origin, app] of denied)
    it(`denies ${p} from ${origin} (app ${app})`, () => expect(permissionDecision(p, origin, app)).toBe(false));
});

describe("downloadDecision (D5)", () => {
  it("accepts only app-origin downloads in the app partition", () => {
    expect(downloadDecision({ partition: "persist:open-agent", url: `${O}/api/artifacts/AbCdEfGhIjKl?format=pdf`, appOrigin: O })).toBe(
      "save",
    );
    expect(downloadDecision({ partition: "persist:open-agent", url: "https://example.com/x.pdf", appOrigin: O })).toBe("cancel");
    expect(downloadDecision({ partition: "persist:open-agent", url: "data:text/plain,hi", appOrigin: O })).toBe("cancel");
    expect(downloadDecision({ partition: "persist:open-agent", url: "blob:http://127.0.0.1:18420/abc", appOrigin: O })).toBe("cancel");
    expect(downloadDecision({ partition: "persist:open-agent", url: "http://localhost:18420/x", appOrigin: O })).toBe("cancel");
    expect(downloadDecision({ partition: "persist:open-agent", url: `${O}/x`, appOrigin: undefined })).toBe("cancel");
  });

  it("cancels every download in any other session", () => {
    for (const partition of ["shell", "default", "update-check"])
      expect(downloadDecision({ partition, url: `${O}/x`, appOrigin: O })).toBe("cancel");
  });
});
