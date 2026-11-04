import type { SlotItemProps } from "@oab/ui/platform";
import { Link } from "@oab/ui/platform";
import { Shield } from "lucide-react";
import type { ReactNode } from "react";
import { SignOutForm } from "@/components/auth/SignOutForm";

export function SignOutItem({ id, role, className, children }: SlotItemProps & { children: ReactNode }) {
  return (
    <SignOutForm id={id} scope="local" role={role} className={className}>
      {children}
    </SignOutForm>
  );
}

export function AdminItem({ id, role, className, onSelect }: SlotItemProps) {
  return (
    <Link id={`${id}-admin`} href="/admin" role={role} onClick={onSelect} className={className}>
      <Shield id={`${id}-admin-icon`} aria-hidden="true" size={15} />
      Admin
    </Link>
  );
}
