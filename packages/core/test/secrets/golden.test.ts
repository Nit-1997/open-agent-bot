import { describe, expect, it } from "vitest";
import { CredentialIntegrityError, open, type Sealed } from "../../src/secrets/envelope.js";
import { LocalKeyWrapper } from "../../src/secrets/keyWrapper.js";
import { parseCredentialKeys } from "../../src/secrets/keys.js";
import { TEST_KEY_B64 } from "../fixtures/config.js";
import { ALICE, BOB } from "../fixtures/users.js";

const PLAINTEXT = '{"type":"api_key","key":"sk-golden-fixture-not-a-real-key"}';

const SEALED_BEFORE_M1_5: Sealed = {
  ciphertext: Buffer.from("AkJDCJMAgk8SXaTgnEz8V9gTwKaNRZn2syx7ddvicKWY1RWHM1a0Nta13KLpx7TnETizTN6SQQl1QudUy+SPRdpXMw0ZkkKfOrPY", "base64"),
  nonce: Buffer.from("jwpaAw7mR1A390Rh", "base64"),
  dekWrapped: Buffer.from("enP1Onl8vmfw5PcCm/lpawPpfYKoW24AnH6+S4Ono37NZpcnyd1CvJsrKGI4J/s5", "base64"),
  dekNonce: Buffer.from("Fie9shLv3zECWExI", "base64"),
  keyVersion: 1,
};

const wrapper = new LocalKeyWrapper(parseCredentialKeys(`v1:${TEST_KEY_B64}`));

describe("credential sealed before the secrets port", () => {
  it("opens to the original plaintext for the user it was sealed for", async () => {
    const plain = await open(wrapper, SEALED_BEFORE_M1_5, { userId: ALICE.id, provider: "openrouter", kind: "api_key" });
    expect(plain.toString("utf8")).toBe(PLAINTEXT);
  });

  it("keeps the user, provider and kind bound into the AAD", async () => {
    for (const ctx of [
      { userId: BOB.id, provider: "openrouter", kind: "api_key" as const },
      { userId: ALICE.id, provider: "groq", kind: "api_key" as const },
      { userId: ALICE.id, provider: "openrouter", kind: "oauth" as const },
    ])
      await expect(open(wrapper, SEALED_BEFORE_M1_5, ctx)).rejects.toBeInstanceOf(CredentialIntegrityError);
  });
});
