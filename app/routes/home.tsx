import type { Route } from "./+types/home";
import { redirect } from "react-router";

import { getAuthenticatedUser } from "~/lib/auth/session.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Notas privadas" },
    { name: "description", content: "Tus notas privadas." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getAuthenticatedUser(request);

  throw redirect(user ? "/app" : "/auth/login");
}
