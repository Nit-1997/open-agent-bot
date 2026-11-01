import { isIP } from "node:net";

export function ipKey(raw: string): string {
  const ip = raw.trim();
  if (isIP(ip) !== 6) return ip;
  const h = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mapped) {
    const [hi, lo] = [Number.parseInt(mapped[1], 16), Number.parseInt(mapped[2], 16)];
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  const [head, tail = ""] = h.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = h.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}
