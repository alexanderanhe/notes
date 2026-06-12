import {
  clearPendingTotpHeaders,
  getPendingTotp,
  requireUser,
} from "~/lib/auth/session.server";
import { totpOnlySchema } from "~/lib/auth/schemas";
import {
  decryptTotpSecret,
  generateBackupCodes,
  verifyTotpCode,
} from "~/lib/auth/two-factor.server";
import { enableTwoFactor } from "~/lib/auth/users.server";
import { assertSameOrigin, enforceRateLimit, getRequestId, logSafe } from "~/lib/security.server";

import type { Route } from "./+types/api.2fa.setup.confirm";

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "2fa_setup_confirm", limit: 8, windowMs: 15 * 60_000 });
  const user = await requireUser(request);
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 });
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 });
  const parsed = totpOnlySchema.safeParse(await request.json());
  const pending = await getPendingTotp(request);
  if (!parsed.success || !pending) {
    return Response.json({ error: "Start 2FA setup again." }, { status: 400 });
  }

  let valid = false;
  try {
    valid = await verifyTotpCode(decryptTotpSecret(pending), parsed.data.code);
  } catch {
    return Response.json({ error: "Start 2FA setup again." }, { status: 400 });
  }
  if (!valid) return Response.json({ error: "The code is invalid." }, { status: 400 });

  const backup = await generateBackupCodes();
  if (!(await enableTwoFactor(user._id, pending, backup.hashes))) {
    return Response.json({ error: "2FA could not be enabled." }, { status: 409 });
  }
  logSafe("info", "two_factor_enabled", { requestId: getRequestId(request), userId: user._id.toHexString() });
  return Response.json(
    { success: true, backupCodes: backup.codes },
    { headers: await clearPendingTotpHeaders(request) },
  );
}
