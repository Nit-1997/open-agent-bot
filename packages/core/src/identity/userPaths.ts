export const USER_PATHS = [
  "/agui",
  "/chats",
  "/chats/*",
  "/profile",
  "/settings",
  "/settings/*",
  "/places",
  "/onboarding/*",
  "/models",
  "/providers",
  "/providers/*",
  "/artifacts/*",
  "/reports",
  "/reports/*",
  "/search",
] as const;

const segments = (path: string) => path.split("/").filter(Boolean);
const isWildcard = (s: string) => s.includes("*");
const isParam = (s: string) => s.startsWith(":");
const isOptional = (s: string) => isParam(s) && s.endsWith("?");

function overlap(a: string[], b: string[]): boolean {
  const [x, ...restA] = a;
  const [y, ...restB] = b;
  if ((x !== undefined && isWildcard(x)) || (y !== undefined && isWildcard(y))) return true;
  if (x === undefined || y === undefined) return (x === undefined ? b : a).every(isOptional);
  if (isOptional(x) && overlap(restA, b)) return true;
  if (isOptional(y) && overlap(a, restB)) return true;
  return (isParam(x) || isParam(y) || x === y) && overlap(restA, restB);
}

export function pathCovered(path: string): boolean {
  return USER_PATHS.some((user) => overlap(segments(path), segments(user)));
}
