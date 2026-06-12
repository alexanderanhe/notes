import QRCode from "qrcode";

import {
  setPendingTotpHeaders,
  requireUser,
} from "~/lib/auth/session.server";
import {
  createTotpSetup,
  encryptTotpSecret,
} from "~/lib/auth/two-factor.server";
import { assertSameOrigin, enforceRateLimit } from "~/lib/security.server";

import type { Route } from "./+types/api.2fa.setup.start";

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "2fa_setup_start", limit: 5, windowMs: 15 * 60_000 });
  const user = await requireUser(request);
  if (request.method !== "POST") throw new Response("Method not allowed.", { status: 405 });
  if (user.twoFactor?.enabled) {
    return Response.json({ error: "Two-factor authentication is already enabled." }, { status: 409 });
  }

  const setup = createTotpSetup(user.email);
  const qrDataUrl = await QRCode.toDataURL(setup.otpauthUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 280,
  });
  return Response.json(
    { qrDataUrl, manualKey: setup.secret },
    { headers: await setPendingTotpHeaders(request, encryptTotpSecret(setup.secret)) },
  );
}
