import { describe, expect, it } from "vitest";
import type { PullRow, ShellState } from "../src/shared/actions.ts";
import { type Block, pullDetail, screenModel } from "../src/shared/screenModel.ts";

const row = (o: Partial<PullRow> = {}): PullRow => ({ name: "agent", ref: "r", layersDone: 0, layersTotal: 0, done: false, ...o });
const progress = (o: Partial<ShellState> = {}): ShellState => ({ phase: "pulling", screen: "screen-progress", test: true, ...o });
const text = (blocks: readonly Block[], key: string) => {
  const b = blocks.find((x) => x.key === key);
  return b && "text" in b ? b.text : undefined;
};

describe("progress screen (review fixes C9, V7)", () => {
  it("shows preparing… instead of layer 0 of 0 before the layer count is known", () => {
    expect(pullDetail([row(), row({ name: "search" })]).detail).toBe("agent, search · preparing…");
    expect(pullDetail([row({ bytesTotal: 0, bytesDone: 0 })]).detail).not.toMatch(/of 0\b/);
  });

  it("shows the layer count once it is known", () => {
    expect(pullDetail([row({ layersDone: 1, layersTotal: 3 })]).detail).toBe("agent · layer 1 of 3");
    expect(pullDetail([row({ layersDone: 1, layersTotal: 3 }), row({ name: "search" })]).detail).toBe("agent, search · layer 1 of 3");
  });

  it("carries the mockup's two lines", () => {
    const m = screenModel(progress());
    expect(m.id).toBe("screen-progress");
    expect(text(m.blocks, "about")).toBe(
      "Everything runs on this Mac in Docker. The first start downloads about 2 GB; after that it starts in seconds.",
    );
    expect(text(m.blocks, "privacy")).toBe("No account. No telemetry. Only your Mac can reach these services.");
  });
});
