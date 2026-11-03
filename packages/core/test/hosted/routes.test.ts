import { describe, it } from "vitest";

describe("hostedRoutes", () => {
  it.todo("mounts access as public at / and admin as protected at /admin, and passes the mount checks");
  it.todo("registers the admin guard on /admin and /admin/* before the admin routes");
  it.todo("hides admin routes from a non-admin and lets the admin list users and requests");
  it.todo("answers 401 signed_out on %s without a bearer");
  it.todo("never authenticates inside the admin guard");
  it.todo("refuses a wrong service secret before anything else");
});
