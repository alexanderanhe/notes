import { requireUser } from "~/lib/auth/session.server";
import { backgroundPreferenceSchema } from "~/lib/auth/schemas";
import { setBackgroundPreference } from "~/lib/auth/users.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.preferences.background";

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, {
    bucket: "background_preference",
    limit: 30,
    windowMs: 60_000,
  });
  if (request.method !== "POST") {
    throw new Response("Method not allowed.", { status: 405 });
  }
  const user = await requireUser(request);
  const parsed = backgroundPreferenceSchema.safeParse(await request.json());
  if (
    !parsed.success ||
    !(await setBackgroundPreference(user._id, parsed.data.backgroundUrl))
  ) {
    return Response.json(
      { error: "The background could not be saved." },
      { status: 400 },
    );
  }
  return Response.json({ success: true, backgroundUrl: parsed.data.backgroundUrl });
}
