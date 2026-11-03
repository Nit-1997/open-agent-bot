import type { Overlay } from "../../components/shell/ShellProvider.tsx";
import { REPORT_TOOLS } from "../reportRefs.ts";
import type { Breakpoint } from "./breakpoints";

export type AutoOpenInput = {
  tool: string;
  reportId: string | null;
  active: boolean;
  visible: boolean;
  breakpoint: Breakpoint;
  overlay: Overlay;
  dismissed: boolean;
  picked: boolean;
  panelOpen: boolean;
};

export function shouldAutoOpen(i: AutoOpenInput): boolean {
  return (
    REPORT_TOOLS.has(i.tool) &&
    i.reportId !== null &&
    i.active &&
    i.visible &&
    i.breakpoint === "desktop" &&
    i.overlay === "none" &&
    !i.dismissed &&
    !(i.picked && i.panelOpen)
  );
}
