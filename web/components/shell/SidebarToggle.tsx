import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { RailButton } from "./RailLink";

export function SidebarToggle(props: { id: string; open: boolean; onToggle: () => void }) {
  return (
    <RailButton
      id={props.id}
      label={props.open ? "Collapse sidebar" : "Expand sidebar"}
      icon={props.open ? PanelLeftClose : PanelLeftOpen}
      expanded={props.open}
      controls="sidebar"
      onClick={props.onToggle}
    />
  );
}
