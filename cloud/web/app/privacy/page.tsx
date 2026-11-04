import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { loadLegal } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy · Open Agent" };

export default function PrivacyPage() {
  return <LegalPage id="privacy" doc={loadLegal("privacy")} />;
}
