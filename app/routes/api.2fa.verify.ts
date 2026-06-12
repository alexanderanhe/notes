import {
  completeTwoFactorHeaders,
  recordTwoFactorFailure,
  requirePendingTwoFactorUser,
} from "~/lib/auth/session.server";
import { twoFactorVerifySchema } from "~/lib/auth/schemas";
import { verifyUserTwoFactorCode } from "~/lib/auth/two-factor.server";
import { assertSameOrigin, enforceRateLimit, getRequestId, logSafe } from "~/lib/security.server";

import type { Route } from "./+types/api.2fa.verify";

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "2fa_verify", limit: 10, windowMs: 15 * 60_000 });
  const user = await requirePendingTwoFactorUser(request);
  if (request.method !== "POST") throw new Response("Método no permitido.", { status: 405 });
  const parsed = twoFactorVerifySchema.safeParse(await request.json());
  if (!parsed.success) return failed(request, user._id.toHexString());

  const twoFactor = user.twoFactor!;
  const valid = await verifyUserTwoFactorCode(user, parsed.data.code);

  if (!valid) return failed(request, user._id.toHexString());
  logSafe("info", "two_factor_login_succeeded", { requestId: getRequestId(request), userId: user._id.toHexString() });
  return Response.json(
    { success: true, backupCodesRemaining: valid ? twoFactor.backupCodesHash.length - (parsed.data.code.includes("-") ? 1 : 0) : 0 },
    { headers: await completeTwoFactorHeaders(request) },
  );
}

async function failed(request: Request, userId: string) {
  const failure = await recordTwoFactorFailure(request);
  logSafe("warn", "two_factor_login_failed", { requestId: getRequestId(request), userId });
  return Response.json(
    {
      error: failure.locked
        ? "Demasiados intentos. Inicia sesión nuevamente."
        : "El código no es válido.",
      sessionInvalidated: failure.locked,
    },
    { status: failure.locked ? 401 : 400, headers: failure.headers },
  );
}
