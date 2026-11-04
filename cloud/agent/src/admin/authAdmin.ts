import { UserError } from "@oab/core/lib/errors.js";
import type { User } from "@supabase/supabase-js";
import type { Db } from "../store/client.js";

export type AuthAccount = {
  id: string;
  email: string;
  isAdmin: boolean;
  bannedUntil: string | null;
  lastSignInAt: string | null;
  providers: string[];
};

export type EmailResult = { ok: true; userId: string | null } | { ok: false; code: string; message: string };

export interface AuthAdmin {
  getUser(id: string): Promise<AuthAccount | undefined>;
  invite(email: string, name: string): Promise<EmailResult>;
  magicLink(email: string): Promise<EmailResult>;
  setBanned(id: string, banned: boolean): Promise<void>;
  deleteUser(id: string): Promise<void>;
}

const BAN_FOREVER = "876000h";

const toAccount = (u: User): AuthAccount => ({
  id: u.id,
  email: (u.email ?? "").toLowerCase(),
  isAdmin: (u.app_metadata as { role?: unknown } | undefined)?.role === "admin",
  bannedUntil: (u as User & { banned_until?: string | null }).banned_until ?? null,
  lastSignInAt: u.last_sign_in_at ?? null,
  providers: [...new Set((u.identities ?? []).map((i) => i.provider))].sort(),
});

type AuthFailure = { code?: string; status?: number; message?: string; name?: string };
const failure = (e: AuthFailure): EmailResult => ({
  ok: false,
  code: e.code ?? (e.status ? `http_${e.status}` : "unreachable"),
  message: (e.message ?? "").slice(0, 300),
});

function authError(where: string, e: AuthFailure): UserError {
  if (!e.status) return new UserError("Can't reach the account service. Try again in a minute.", "unavailable");
  return new UserError(`The account service refused ${where} (${e.code ?? e.status}).`, "upstream");
}

export function createAuthAdmin(deps: { service: Db; anon: Db; appOrigin: string }): AuthAdmin {
  const admin = deps.service.auth.admin;
  const redirectTo = `${deps.appOrigin}/auth/confirm`;
  return {
    async getUser(id) {
      const { data, error } = await admin.getUserById(id);
      if (error) {
        if (error.status === 404) return undefined;
        throw authError("the lookup", error);
      }
      return data.user ? toAccount(data.user) : undefined;
    },
    async invite(email, name) {
      const { data, error } = await admin.inviteUserByEmail(email, { redirectTo, data: { name } });
      return error ? failure(error) : { ok: true, userId: data.user?.id ?? null };
    },
    async magicLink(email) {
      const { error } = await deps.anon.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
      return error ? failure(error) : { ok: true, userId: null };
    },
    async setBanned(id, banned) {
      const { error } = await admin.updateUserById(id, { ban_duration: banned ? BAN_FOREVER : "none" });
      if (error) throw authError("the update", error);
    },
    async deleteUser(id) {
      const { error } = await admin.deleteUser(id);
      if (error && error.status !== 404) throw authError("the delete", error);
    },
  };
}
