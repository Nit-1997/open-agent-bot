import type { ReactNode } from "react";

export function SignOutForm(props: {
  id: string;
  scope: "local" | "global";
  className: string;
  label?: string;
  role?: "menuitem";
  children: ReactNode;
}) {
  return (
    <form id={`${props.id}-form`} method="post" action="/auth/signout">
      <input id={`${props.id}-scope`} type="hidden" name="scope" value={props.scope} />
      <button id={props.id} type="submit" role={props.role} aria-label={props.label} className={props.className}>
        {props.children}
      </button>
    </form>
  );
}
