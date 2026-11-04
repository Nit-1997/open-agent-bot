import type { Store } from "@oab/core/store/types.js";
import type { Db } from "./client.js";
import { forUser } from "./users.js";

export const createSupabaseStore = (db: Db): Store => ({ forUser: (userId) => forUser(db, userId) });
