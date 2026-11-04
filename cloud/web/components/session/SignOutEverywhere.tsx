import { SignOutForm } from "@/components/auth/SignOutForm";

export function SignOutEverywhere({ id }: { id: string }) {
  return (
    <div id={`${id}-row`}>
      <SignOutForm id={id} scope="global" className="block text-sm text-text-secondary underline-offset-4 hover:underline">
        Sign out on all devices
      </SignOutForm>
      <p id={`${id}-hint`} className="text-xs text-text-muted">
        Ends your sessions on every phone and computer, not just this one.
      </p>
    </div>
  );
}
