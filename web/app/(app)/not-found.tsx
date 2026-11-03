import { Link } from "@oab/ui/platform";

export default function ShellNotFound() {
  return (
    <div id="shell-not-found" className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 id="shell-not-found-title" className="font-display text-[30px] leading-tight text-text-primary">
        This page doesn&apos;t exist.
      </h1>
      <Link
        id="shell-not-found-home"
        href="/"
        className="rounded-full bg-charcoal px-4 py-2 text-sm font-medium text-on-charcoal hover:opacity-85"
      >
        Back to chat
      </Link>
    </div>
  );
}
