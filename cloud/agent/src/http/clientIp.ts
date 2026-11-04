export const clientIp = (raw: string | undefined) => (raw ?? "").split(",")[0].trim().slice(0, 64) || "unknown";
