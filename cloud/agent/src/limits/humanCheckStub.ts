import type { HumanCheckState } from "@oab/shared/usage";

export interface HumanCheckGate {
  state(userId: string): Promise<HumanCheckState>;
}

export const humanCheckOff: HumanCheckGate = { state: async () => "off" };
