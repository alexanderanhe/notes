import { requireRecent2FA } from "~/lib/auth/session.server";
import { generateBackupCodes } from "~/lib/auth/two-factor.server";
import { replaceBackupCodes } from "~/lib/auth/users.server";
import { assertSameOrigin, enforceRateLimit, getRequestId, logSafe } from "~/lib/security.server";

import type { Route } from "./+types/api.2fa.backup-codes.regenerate";

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "2fa_backup_regenerate", limit: 5, windowMs: 15 * 60_000 });
  const user = await requireRecent2FA(
    request,
    undefined,
    "/settings/security?action=regenerate",
  );
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 });
  const backup = await generateBackupCodes();
  await replaceBackupCodes(user._id, backup.hashes);
  logSafe("info", "two_factor_backup_codes_regenerated", { requestId: getRequestId(request), userId: user._id.toHexString() });
  return Response.json({ success: true, backupCodes: backup.codes });
}
