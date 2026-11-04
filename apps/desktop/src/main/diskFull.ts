const PATTERN = /no space left on device|database or disk is full|SQLITE_FULL|ENOSPC/i;

export function isDiskFull(v: string | NodeJS.ErrnoException | undefined): boolean {
  if (v === undefined) return false;
  if (typeof v === "string") return PATTERN.test(v);
  return v.code === "ENOSPC" || PATTERN.test(v.message ?? "");
}

export type DiskEngineHint = Readonly<{ engine: string; line: string }>;

export function diskHint(engine: string): DiskEngineHint {
  switch (engine) {
    case "docker-desktop":
      return { engine: "Docker Desktop", line: 'Docker Desktop → Settings → Resources → "Disk usage limit": raise it.' };
    case "colima":
      return { engine: "Colima", line: "Restart Colima with a bigger disk: colima stop && colima start --disk <GB>" };
    case "orbstack":
      return { engine: "OrbStack", line: "OrbStack grows up to the Mac's free space: free some space on this Mac." };
    case "rancher-desktop":
      return { engine: "Rancher Desktop", line: "Rancher Desktop → Preferences → Virtual Machine: give it more disk." };
    default:
      return { engine: "Docker", line: "Give your Docker engine more disk space." };
  }
}
