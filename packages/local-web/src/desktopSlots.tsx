import type { PlatformSlots, SlotItemProps } from "@oab/ui/platform";

export type DesktopBridge = Readonly<{ openServices: () => void }>;

declare global {
  interface Window {
    openAgentDesktop?: DesktopBridge;
  }
}

const isBridge = (v: unknown): v is DesktopBridge =>
  typeof v === "object" && v !== null && typeof (v as { openServices?: unknown }).openServices === "function";

function ServerIcon({ id }: { id: string }) {
  return (
    <svg
      id={id}
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect id={`${id}-top`} width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect id={`${id}-bottom`} width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <line id={`${id}-top-dot`} x1="6" x2="6.01" y1="6" y2="6" />
      <line id={`${id}-bottom-dot`} x1="6" x2="6.01" y1="18" y2="18" />
    </svg>
  );
}

export function desktopSlots(bridge: unknown): PlatformSlots {
  if (!isBridge(bridge)) return {};
  const desktop = bridge;
  function ServicesMenuItem(props: SlotItemProps) {
    return (
      <button
        id={`${props.id}-services`}
        type="button"
        role={props.role}
        className={props.className}
        onClick={() => {
          props.onSelect();
          desktop.openServices();
        }}
      >
        <ServerIcon id={`${props.id}-services-icon`} />
        Services & data
      </button>
    );
  }
  return { accountMenuExtra: ServicesMenuItem };
}
