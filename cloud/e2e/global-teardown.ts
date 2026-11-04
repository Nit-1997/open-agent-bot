import { cleanupE2e } from "./support/users";

export default async function globalTeardown(): Promise<void> {
  cleanupE2e();
}
