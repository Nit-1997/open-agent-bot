"use client";

import { Check, LogOut, Moon, SlidersHorizontal, UserRound } from "lucide-react";
import { usePlatform } from "@oab/ui/platform";
import { useState } from "react";
import { AgentOrb } from "@/components/agent/AgentOrb";
import { useShell } from "@/components/shell/ShellProvider";
import { isDark, setTheme } from "@/lib/theme";

const ITEM =
  "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-text-secondary transition hover:bg-surface hover:text-text-primary focus-visible:bg-surface";
const SHEET_ITEM = `${ITEM} min-h-11 text-[15px]`;

export function AccountMenuItems(props: { id: string; variant: "menu" | "sheet"; onDone: () => void }) {
  const { id, variant, onDone } = props;
  const { user, profile, persona, open, close } = useShell();
  const { signOut: SignOut, accountMenuExtra: Extra } = usePlatform().slots;
  const [dark, setDark] = useState(isDark);
  const menu = variant === "menu";
  const role = menu ? "menuitem" : undefined;
  const cls = menu ? ITEM : SHEET_ITEM;
  const name = profile.name?.trim() || user.name;
  const go = (o: "profile" | "models", focus?: "agent") => {
    onDone();
    open(o, focus && { focus });
  };

  return (
    <>
      <div id={`${id}-who`} className="border-b border-border px-2.5 pb-2 pt-1">
        {name && (
          <p id={`${id}-name`} className="truncate text-sm font-medium text-text-primary">
            {name}
          </p>
        )}
        <p id={`${id}-email`} className="truncate text-xs text-text-muted" title={user.email}>
          {user.email}
        </p>
      </div>
      <div id={`${id}-items`} className="py-1">
        <button id={`${id}-profile`} type="button" role={role} onClick={() => go("profile")} className={cls}>
          <UserRound id={`${id}-profile-icon`} aria-hidden="true" size={15} />
          Profile & settings
        </button>
        <button id={`${id}-agent`} type="button" role={role} onClick={() => go("profile", "agent")} className={cls}>
          <AgentOrb id={`${id}-agent-orb`} look={persona.look} name={persona.name} size={22} className="-mx-0.5" />
          <span id={`${id}-agent-text`}>
            <bdi id={`${id}-agent-name`}>{persona.name}</bdi>, your agent
          </span>
        </button>
        <button id={`${id}-models`} type="button" role={role} onClick={() => go("models")} className={cls}>
          <SlidersHorizontal id={`${id}-models-icon`} aria-hidden="true" size={15} />
          Models and keys
        </button>
        <button
          id={`${id}-theme`}
          type="button"
          role={menu ? "menuitemcheckbox" : "switch"}
          aria-checked={dark}
          onClick={() => {
            setTheme(!dark);
            setDark(!dark);
          }}
          className={cls}
        >
          <Moon id={`${id}-theme-icon`} aria-hidden="true" size={15} />
          <span id={`${id}-theme-text`} className="flex-1">
            Dark theme
          </span>
          {dark && <Check id={`${id}-theme-check`} aria-hidden="true" size={15} />}
        </button>
        {Extra && (
          <Extra
            id={id}
            role={role}
            className={cls}
            onSelect={() => {
              onDone();
              close();
            }}
          />
        )}
      </div>
      <div id={`${id}-footer`} className="border-t border-border pt-1">
        {SignOut && (
          <SignOut id={`${id}-signout`} role={role} className={cls} onSelect={onDone}>
            <LogOut id={`${id}-signout-icon`} aria-hidden="true" size={15} />
            Sign out
          </SignOut>
        )}
      </div>
    </>
  );
}
