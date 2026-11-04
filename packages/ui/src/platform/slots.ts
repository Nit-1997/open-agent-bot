import type { RunRefusal, RunRefusalCode } from "@oab/shared/runRefusals";
import type { ComponentType, ReactNode } from "react";

export type SlotItemProps = Readonly<{ id: string; role?: "menuitem"; className: string; onSelect: () => void }>;

export type RunRefusalNoticeProps = Readonly<{ id: string; refusal: RunRefusal; onRetry: () => void; onDismiss: () => void }>;

export type RunRefusalSlot = Readonly<{ codes: readonly RunRefusalCode[]; Notice: ComponentType<RunRefusalNoticeProps> }>;

export type PlatformSlots = Readonly<{
  signOut?: ComponentType<SlotItemProps & { children: ReactNode }>;
  signOutEverywhere?: ComponentType<{ id: string }>;
  accountMenuExtra?: ComponentType<SlotItemProps>;
  signedOutNotice?: ComponentType;
  accessDisabledNotice?: ComponentType;
  usageMeter?: ComponentType<{ id: string; variant: "sidebar" | "sheet" }>;
  runRefusal?: RunRefusalSlot;
}>;
