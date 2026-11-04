import { vi } from "vitest";

export const PINNED_NOW = new Date("2026-11-02T12:00:00Z");
export const LOCALE = "en-US";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Restore = () => void;

function defaultLocale<T extends object>(Ctor: T): T {
  return new Proxy(Ctor, {
    construct: (target, [locales, options]) => Reflect.construct(target as never, [locales ?? LOCALE, options]),
    apply: (target, self, [locales, options]) => Reflect.apply(target as never, self, [locales ?? LOCALE, options]),
  });
}

function pinLocale(): Restore {
  const date = Date.prototype;
  const num = Number.prototype;
  const saved = {
    toLocaleString: date.toLocaleString,
    toLocaleDateString: date.toLocaleDateString,
    toLocaleTimeString: date.toLocaleTimeString,
    numberToLocaleString: num.toLocaleString,
    DateTimeFormat: Intl.DateTimeFormat,
    NumberFormat: Intl.NumberFormat,
  };
  date.toLocaleString = function (this: Date, l?: Intl.LocalesArgument, o?: Intl.DateTimeFormatOptions) {
    return saved.toLocaleString.call(this, l ?? LOCALE, o);
  };
  date.toLocaleDateString = function (this: Date, l?: Intl.LocalesArgument, o?: Intl.DateTimeFormatOptions) {
    return saved.toLocaleDateString.call(this, l ?? LOCALE, o);
  };
  date.toLocaleTimeString = function (this: Date, l?: Intl.LocalesArgument, o?: Intl.DateTimeFormatOptions) {
    return saved.toLocaleTimeString.call(this, l ?? LOCALE, o);
  };
  num.toLocaleString = function (this: number, l?: Intl.LocalesArgument, o?: Intl.NumberFormatOptions) {
    return saved.numberToLocaleString.call(this, l ?? LOCALE, o);
  };
  Intl.DateTimeFormat = defaultLocale(saved.DateTimeFormat);
  Intl.NumberFormat = defaultLocale(saved.NumberFormat);
  return () => {
    date.toLocaleString = saved.toLocaleString;
    date.toLocaleDateString = saved.toLocaleDateString;
    date.toLocaleTimeString = saved.toLocaleTimeString;
    num.toLocaleString = saved.numberToLocaleString;
    Intl.DateTimeFormat = saved.DateTimeFormat;
    Intl.NumberFormat = saved.NumberFormat;
  };
}

export function pinEnvironment(): Restore {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PINNED_NOW);
  let n = 0;
  const uuidSpy = vi.spyOn(crypto, "randomUUID").mockImplementation(() => uuid(++n) as ReturnType<Crypto["randomUUID"]>);
  const randomSpy = vi.spyOn(Math, "random").mockImplementation(seeded(20261102));
  const languageSpy = vi.spyOn(navigator, "language", "get").mockReturnValue(LOCALE);
  const restoreLocale = pinLocale();
  return () => {
    restoreLocale();
    languageSpy.mockRestore();
    randomSpy.mockRestore();
    uuidSpy.mockRestore();
    vi.useRealTimers();
  };
}
