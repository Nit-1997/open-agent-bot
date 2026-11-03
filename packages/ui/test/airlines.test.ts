import { describe, expect, it } from "vitest";
import { airlineHost } from "../src/lib/airlines.ts";

describe("airlineHost", () => {
  it("maps airline names, as Google Flights shows them, to their sites", () => {
    expect(airlineHost("Alaska")).toBe("alaskaair.com");
    expect(airlineHost("United")).toBe("united.com");
    expect(airlineHost("Air India")).toBe("airindia.com");
    expect(airlineHost("Delta, KLM")).toBe("delta.com");
  });

  it("returns nothing for airlines it doesn't know", () => {
    expect(airlineHost("Zed Air")).toBeUndefined();
  });
});
