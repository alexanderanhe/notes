import { requireRecent2FA, requireUser } from "~/lib/auth/session.server";
import { enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.vault-items.copy-authorize";

export async function loader({ request }: Route.LoaderArgs) {
  enforceRateLimit(request, { bucket: "vault_item_sensitive_copy", limit: 60, windowMs: 60_000 });
  const user = await requireUser(request);
  if (user.twoFactor?.enabled) await requireRecent2FA(request, undefined, "/app");
  return Response.json({ authorized: true });
}
