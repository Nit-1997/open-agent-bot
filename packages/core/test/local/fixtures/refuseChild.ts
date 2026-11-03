import { ConfigError } from "../../../src/config.js";
import { type RefusalCode, refuse, StartupRefusal } from "../../../src/local/refusal.js";

const [kind, code] = process.argv.slice(2);
if (kind === "config") refuse(new ConfigError(["OPEN_AGENT_PORT must be an integer 1-65535", "SUPABASE_URL is a hosted setting"]));
if (kind === "store") refuse(Object.assign(new Error("database /data/open-agent.db failed quick_check"), { name: "StoreOpenError", code }));
refuse(new StartupRefusal(code as RefusalCode, `refused for ${code} at /keys/kek\nsecond line v1:${"A".repeat(43)}=`));
