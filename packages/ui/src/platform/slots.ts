import type { ComponentType, ReactNode } from "react";

export type SlotItemProps = Readonly<{ id: string; role?: "menuitem"; className: string; onSelect: () => void }>;

export type PlatformSlots = Readonly<{
  signOut?: ComponentType<SlotItemProps & { children: ReactNode }>;
  signOutEverywhere?: ComponentType<{ id: string }>;
  accountMenuExtra?: ComponentType<SlotItemProps>;
  signedOutNotice?: ComponentType;
  accessDisabledNotice?: ComponentType;
  usageMeter?: ComponentType<{ id: string; variant: "sidebar" | "sheet" }>;
}>;
