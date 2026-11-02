import type { ReactNode } from "react";

export function SectionPage(props: { id: string; wide?: boolean; children: ReactNode }) {
  return (
    <div id={props.id} className="min-h-0 flex-1 overflow-y-auto">
      <div id={`${props.id}-inner`} className={`mx-auto w-full px-4 pb-10 sm:px-7 ${props.wide ? "" : "max-w-[880px]"}`}>
        {props.children}
      </div>
    </div>
  );
}
