import { log } from "@oab/core/lib/log.js";

type Handler = (userId: string) => Promise<void>;

export type DemotionHook = { notify(userId: string): Promise<void>; bind(handler: Handler): void };

const failed = (userId: string) => (err: unknown) =>
  log.error(`[auth] demotion cleanup failed user=${userId}`, err instanceof Error ? err.message : err);

export function createDemotionHook(): DemotionHook {
  let handler: Handler | undefined;
  const queued = new Set<string>();
  return {
    async notify(userId) {
      if (!handler) {
        queued.add(userId);
        return;
      }
      await handler(userId);
    },
    bind(next) {
      if (handler) throw new Error("the demotion hook is already bound");
      handler = next;
      const replay = [...queued];
      queued.clear();
      for (const userId of replay) void next(userId).catch(failed(userId));
    },
  };
}
