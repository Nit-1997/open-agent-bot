import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPullParser, layerSizesFromManifest } from "../src/main/pullProgress.ts";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures/docker");
const read = (f: string) => readFileSync(join(FIX, f), "utf8");

describe("pull progress", () => {
  it("parses the recorded busybox pull with sizes from the multi-arch index (arm64, attestations skipped)", () => {
    const sizes = layerSizesFromManifest(read("manifest-busybox.json"), "arm64");
    expect(sizes && [...sizes]).toEqual([["af820adcc158", 1900773]]);
    const p = createPullParser("busybox:1.37", sizes);
    let last = p.current();
    for (const l of read("pull-busybox.txt").split("\n")) last = p.line(l);
    expect(last).toEqual({ ref: "busybox:1.37", layersDone: 1, layersTotal: 1, bytesDone: 1900773, bytesTotal: 1900773, done: true });
  });

  it("picks amd64 for an x86_64 engine and returns undefined for a platform that is absent", () => {
    expect(layerSizesFromManifest(read("manifest-busybox.json"), "x86_64")?.get("68fe9bff2ad4")).toBe(2211514);
    expect(layerSizesFromManifest(read("manifest-busybox.json"), "mips")).toBeUndefined();
    expect(layerSizesFromManifest("not json", "arm64")).toBeUndefined();
  });

  it("reads a single-platform manifest pushed to a local registry", () => {
    const sizes = layerSizesFromManifest(read("manifest-local.json"), "arm64");
    expect(sizes?.size).toBe(7);
  });

  it("counts only go up, unknown lines are ignored, and Already exists counts as done", () => {
    const p = createPullParser("r");
    const seen: number[] = [];
    for (const l of [
      "r: Pulling from x",
      "aaaaaaaaaaaa: Pulling fs layer",
      "bbbbbbbbbbbb: Pulling fs layer",
      "cccccccccccc: Already exists",
      "something odd",
      "aaaaaaaaaaaa: Downloading [==>   ] 1MB/3MB",
      "aaaaaaaaaaaa: Pull complete",
      "aaaaaaaaaaaa: Extracting",
      "bbbbbbbbbbbb: Pull complete",
    ]) {
      const c = p.line(l);
      seen.push(c.layersDone);
      expect(c.layersDone).toBeLessThanOrEqual(c.layersTotal);
    }
    expect(seen).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 3]);
    expect(p.current()).toMatchObject({ layersTotal: 3, done: false });
  });

  it("an image already present finishes with no layer lines", () => {
    const p = createPullParser("r");
    for (const l of read("pull-already.txt").split("\n")) p.line(l);
    expect(p.current()).toEqual({ ref: "r", layersDone: 0, layersTotal: 0, done: true });
  });

  it("a cancelled pull stays not done", () => {
    const p = createPullParser("r");
    p.line("aaaaaaaaaaaa: Pulling fs layer");
    p.line("aaaaaaaaaaaa: Downloading [=>  ] 1MB/9MB");
    expect(p.current()).toEqual({ ref: "r", layersDone: 0, layersTotal: 1, done: false });
  });
});
