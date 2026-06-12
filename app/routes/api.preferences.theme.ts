import { requireUser } from "~/lib/auth/session.server";
import { themePreferenceSchema } from "~/lib/auth/schemas";
import { setThemePreference } from "~/lib/auth/users.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.preferences.theme";

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, {
    bucket: "theme_preference",
    limit: 30,
    windowMs: 60_000,
  });
  if (request.method !== "POST") {
    throw new Response("Method not allowed.", { status: 405 });
  }

  const user = await requireUser(request);
  const parsed = themePreferenceSchema.safeParse(await request.json());
  if (
    !parsed.success ||
    !(await setThemePreference(user._id, parsed.data.theme))
  ) {
    return Response.json(
      { error: "The theme could not be saved." },
      { status: 400 },
    );
  }
  return Response.json({ success: true, theme: parsed.data.theme });
}
