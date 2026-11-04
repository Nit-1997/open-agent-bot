import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { loadLegal } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service · Open Agent" };

export default function TermsPage() {
  return <LegalPage id="terms" doc={loadLegal("terms")} />;
}
