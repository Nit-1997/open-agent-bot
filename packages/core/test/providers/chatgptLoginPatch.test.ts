import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const PI_AI = "@earendil-works/pi-ai";
const piAiDir = (createRequire(import.meta.url).resolve.paths(PI_AI) ?? [])
  .map((dir) => join(dir, PI_AI))
  .find((dir) => existsSync(join(dir, "package.json")));
if (!piAiDir) throw new Error(`${PI_AI} is not installed`);
const { openaiChatGPTOAuth } = await import(pathToFileURL(join(piAiDir, "dist/auth/oauth/openai-chatgpt.js")).href);

const DEVICE_ID = "00000000-0000-4000-8000-000000000000";

function startLogin() {
  const abort = new AbortController();
  const seen = { authUrl: false, prompt: false };
  const interaction = {
    signal: abort.signal,
    notify: (e: { type: string }) => {
      if (e.type === "auth_url") seen.authUrl = true;
    },
    prompt: (p: { signal?: AbortSignal }) => {
      seen.prompt = true;
      return new Promise<string>((_resolve, reject) => {
        p.signal?.addEventListener("abort", () => reject(new Error("prompt aborted")), { once: true });
      });
    },
  };
  const outcome = openaiChatGPTOAuth.login(interaction as never, { getDeviceId: () => DEVICE_ID } as never).then(
    () => "done",
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );
  return { abort, seen, outcome };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

describe("patched ChatGPT sign-in", () => {
  it("lets a second sign-in reach the paste step while the callback port is taken", async () => {
    const first = startLogin();
    await until(() => first.seen.prompt);
    const second = startLogin();
    await until(() => second.seen.prompt);
    expect(second.seen.authUrl).toBe(true);

    let settled = false;
    void second.outcome.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    first.abort.abort();
    second.abort.abort();
    expect(await first.outcome).toBe("Login cancelled");
    expect(await second.outcome).toBe("Login cancelled");
  });
});
