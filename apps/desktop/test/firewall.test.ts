import { describe, expect, it } from "vitest";
import { isLoopbackHost, loopbackFirewall } from "../src/main/firewall.ts";

const P = 18420;

describe("loopbackFirewall (S4)", () => {
  const rows: [string, "allow" | "cancel"][] = [
    [`http://127.0.0.1:${P}/`, "allow"],
    [`http://127.0.0.1:${P}/api/chats?x=1`, "allow"],
    [`ws://127.0.0.1:${P}/socket`, "allow"],
    [`HTTP://127.0.0.1:${P}/`, "allow"],
    [`http://127.0.0.1:${P + 1}/`, "cancel"],
    ["http://127.0.0.1/", "cancel"],
    ["https://127.0.0.1/", "cancel"],
    [`https://127.0.0.1:${P}/`, "allow"],
    ["http://127.1.2.3:8080/", "cancel"],
    [`http://127.1.2.3:${P}/`, "cancel"],
    [`http://127.1:${P + 1}/`, "cancel"],
    [`http://2130706433:${P + 1}/`, "cancel"],
    [`http://0x7f000001:${P + 1}/`, "cancel"],
    [`http://localhost:${P}/`, "cancel"],
    ["http://localhost:3000/", "cancel"],
    [`http://localhost.:${P + 1}/`, "cancel"],
    [`http://LOCALHOST:${P + 1}/`, "cancel"],
    ["http://foo.localhost:8000/", "cancel"],
    ["http://a.b.localhost/", "cancel"],
    ["http://[::1]:8000/", "cancel"],
    [`http://[::1]:${P}/`, "cancel"],
    ["http://[0:0:0:0:0:0:0:1]:8000/", "cancel"],
    ["http://[::ffff:127.0.0.1]:8000/", "cancel"],
    ["http://[::]:8000/", "cancel"],
    ["http://0.0.0.0:8000/", "cancel"],
    [`http://0.0.0.0:${P}/`, "cancel"],
    ["http://0:8000/", "cancel"],
    ["ws://127.0.0.1:9229/devtools", "cancel"],
    ["wss://localhost:8443/", "cancel"],
    [`ws://localhost:${P}/`, "cancel"],
    ["https://example.com/", "allow"],
    ["http://example.com:8080/", "allow"],
    ["wss://example.com/socket", "allow"],
    ["http://127.0.0.1.example.com/", "allow"],
    ["http://localhost.example.com/", "allow"],
    ["http://10.0.0.1:8000/", "allow"],
    ["http://192.168.1.1/", "allow"],
    ["data:text/plain,hi", "allow"],
    ["devtools://devtools/bundled/x.html", "allow"],
    ["not a url", "cancel"],
  ];
  for (const [url, expected] of rows) {
    it(`${expected} ${url}`, () => {
      expect(loopbackFirewall(url, P)).toBe(expected);
    });
  }

  it("cancels every loopback request when no app port is open", () => {
    expect(loopbackFirewall(`http://127.0.0.1:${P}/`, undefined)).toBe("cancel");
    expect(loopbackFirewall("https://example.com/", undefined)).toBe("allow");
  });

  it("knows the loopback names", () => {
    for (const h of ["127.0.0.1", "127.255.255.254", "localhost", "x.localhost", "[::1]", "0.0.0.0", "[::ffff:7f00:1]"])
      expect(isLoopbackHost(h)).toBe(true);
    for (const h of ["example.com", "128.0.0.1", "[2001:db8::1]", "localhostx", "10.0.0.1"]) expect(isLoopbackHost(h)).toBe(false);
  });
});
