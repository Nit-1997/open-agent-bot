import { cookies } from "next/headers";

export async function dropSessionCookies(): Promise<void> {
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) if (name.startsWith("sb-")) cookieStore.delete({ name, path: "/" });
}
