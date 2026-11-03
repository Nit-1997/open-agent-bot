export type Segments =
  | { kind: "outside" }
  | { kind: "redirect"; location: string }
  | { kind: "malformed" }
  | { kind: "segments"; segments: string[] };

export function segmentsOf(pathname: string, basePath: string): Segments {
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return { kind: "outside" };
  const raw = pathname.slice(basePath.length).split("/").slice(1);
  if (raw.includes("")) return { kind: "redirect", location: [basePath, ...raw.filter(Boolean)].join("/") };
  const segments: string[] = [];
  for (const segment of raw) {
    try {
      segments.push(decodeURIComponent(segment));
    } catch {
      return { kind: "malformed" };
    }
  }
  return { kind: "segments", segments };
}

export const joinSegments = (segments: readonly string[]): string => segments.join("/");

export const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");
