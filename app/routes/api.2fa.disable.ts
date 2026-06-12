import { requireRecent2FA } from "~/lib/auth/session.server";
import { disableTwoFactor } from "~/lib/auth/users.server";
import { hasCriticalNotes } from "~/lib/notes.server";
import { assertSameOrigin, enforceRateLimit, getRequestId, logSafe } from "~/lib/security.server";

import type { Route } from "./+types/api.2fa.disable";

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "2fa_disable", limit: 5, windowMs: 15 * 60_000 });
  const user = await requireRecent2FA(
    request,
    undefined,
    "/settings/security?action=disable",
  );
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 });
  if (await hasCriticalNotes(user._id)) {
    return Response.json(
      { error: "Remove critical mode from your notes before disabling 2FA." },
      { status: 409 },
    );
  }
  await disableTwoFactor(user._id);
  logSafe("info", "two_factor_disabled", { requestId: getRequestId(request), userId: user._id.toHexString() });
  return Response.json({ success: true });
}
