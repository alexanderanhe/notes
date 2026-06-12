import {
  requireRecent2FA,
  requireUser,
} from "~/lib/auth/session.server";
import { securityPreferencesSchema } from "~/lib/auth/schemas";
import { setSecurityPreferences } from "~/lib/auth/users.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.security.preferences";

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, {
    bucket: "security_preferences",
    limit: 10,
    windowMs: 15 * 60_000,
  });
  if (request.method !== "POST") {
    throw new Response("Método no permitido.", { status: 405 });
  }

  let user = await requireUser(request);
  if (user.twoFactor?.enabled) {
    user = await requireRecent2FA(request, undefined, "/settings/security");
  }
  const parsed = securityPreferencesSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Preferencias inválidas." }, { status: 400 });
  }
  if (!(await setSecurityPreferences(user._id, parsed.data))) {
    return Response.json(
      { error: "No fue posible guardar las preferencias." },
      { status: 400 },
    );
  }
  return Response.json({ success: true, preferences: parsed.data });
}
