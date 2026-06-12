import { redirect } from "react-router";

import { destroyUserSession } from "~/lib/auth/session.server";
import { assertSameOrigin } from "~/lib/security.server";

import type { Route } from "./+types/auth.logout";

export async function loader() {
  throw redirect("/app");
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  return destroyUserSession(request);
}
