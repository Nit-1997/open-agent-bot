import { log } from "@oab/core/lib/log.js";
import type { HumanCheckState, SignupMode } from "@oab/shared/usage";

export interface HumanCheckGate {
  state(userId: string): Promise<HumanCheckState>;
}

export type HumanChecks = { get(userId: string): Promise<boolean>; set(userId: string): Promise<void> };

export type HumanCheckGateDeps = {
  mode: () => Promise<SignupMode | "unknown">;
  checks: HumanChecks;
  verifierConfigured: boolean;
  maxRemembered?: number;
};

export const MAX_REMEMBERED_CHECKS = 100_000;

export const gateApplies = (mode: SignupMode | "unknown") => mode === "open" || mode === "unknown";

export class LiveHumanCheckGate implements HumanCheckGate {
  private readonly done = new Set<string>();
  private readonly max: number;

  constructor(private readonly deps: HumanCheckGateDeps) {
    this.max = deps.maxRemembered ?? MAX_REMEMBERED_CHECKS;
  }

  async state(userId: string): Promise<HumanCheckState> {
    if (!gateApplies(await this.deps.mode())) return "off";
    if (this.done.has(userId)) return "done";
    let checked: boolean;
    try {
      checked = await this.deps.checks.get(userId);
    } catch (err) {
      log.warn(`[signup] human check lookup failed user=${userId}`, err instanceof Error ? err.message : err);
      return "unavailable";
    }
    if (checked) {
      this.remember(userId);
      return "done";
    }
    return this.deps.verifierConfigured ? "required" : "unavailable";
  }

  async confirm(userId: string): Promise<void> {
    await this.deps.checks.set(userId);
    this.remember(userId);
  }

  private remember(userId: string): void {
    if (this.done.size >= this.max) {
      const oldest = this.done.values().next().value;
      if (oldest !== undefined) this.done.delete(oldest);
    }
    this.done.add(userId);
  }
}
