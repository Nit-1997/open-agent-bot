"use client";

import { usePlatform } from "@oab/ui/platform";
import { AccountMenuItems } from "./AccountMenuItems";
import { Overlay } from "./Overlay";
import { useShell } from "./ShellProvider";

export function AccountSheet() {
  const { close } = useShell();
  const UsageMeter = usePlatform().slots.usageMeter;
  return (
    <Overlay
      id="account-sheet"
      label="Account"
      side="bottom"
      onClose={close}
      panelClassName="rounded-t-[24px] border-t border-border bg-paper p-2 pb-[calc(12px+env(safe-area-inset-bottom))] shadow-lift"
    >
      <span id="account-sheet-grip" aria-hidden="true" className="mx-auto mb-2 mt-1 block h-1 w-10 rounded-full bg-border" />
      <div id="account-sheet-body" className="overflow-y-auto">
        {UsageMeter && (
          <div id="account-sheet-usage">
            <UsageMeter id="account-sheet-usage-meter" variant="sheet" />
          </div>
        )}
        <AccountMenuItems id="account-sheet" variant="sheet" onDone={() => {}} />
      </div>
    </Overlay>
  );
}
