import {
  completeRecentTwoFactor,
  recordTwoFactorFailure,
  requireUser,
} from "~/lib/auth/session.server";
import { twoFactorVerifySchema } from "~/lib/auth/schemas";
import { verifyUserTwoFactorCode } from "~/lib/auth/two-factor.server";
import {
  assertSameOrigin,
  enforceRateLimit,
  getRequestId,
  logSafe,
} from "~/lib/security.server";

import type { Route } from "./+types/api.2fa.confirm-action";

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, {
    bucket: "2fa_confirm_action",
    limit: 10,
    windowMs: 15 * 60_000,
  });
  if (request.method !== "POST") {
    throw new Response("Método no permitido.", { status: 405 });
  }

  const user = await requireUser(request);
  if (!user.twoFactor?.enabled) {
    return Response.json(
      { error: "No fue posible confirmar esta acción." },
      { status: 403 },
    );
  }

  const parsed = twoFactorVerifySchema.safeParse(await request.json());
  const valid =
    parsed.success &&
    (await verifyUserTwoFactorCode(user, parsed.data.code));

  if (!valid) {
    const failure = await recordTwoFactorFailure(request);
    logSafe("warn", "two_factor_step_up_failed", {
      requestId: getRequestId(request),
      userId: user._id.toHexString(),
    });
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

  const completion = await completeRecentTwoFactor(request);
  logSafe("info", "two_factor_step_up_succeeded", {
    requestId: getRequestId(request),
    userId: user._id.toHexString(),
  });
  return Response.json(
    { success: true, redirectTo: completion.redirectTo },
    { headers: completion.headers },
  );
}
