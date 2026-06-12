import { createCookieSessionStorage, redirect } from "react-router";

import { getEnv } from "./env.server";
import { findUserById } from "./users.server";

interface SessionData {
  userId: string;
}

let storage: ReturnType<typeof createCookieSessionStorage<SessionData>>;

function getSessionStorage() {
  storage ??= createCookieSessionStorage<SessionData>({
    cookie: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-notes_session"
          : "__notes_session",
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
      secrets: [getEnv("SESSION_SECRET")],
      secure: process.env.NODE_ENV === "production",
    },
  });

  return storage;
}

export async function getUserId(request: Request) {
  const session = await getSessionStorage().getSession(
    request.headers.get("Cookie"),
  );
  return session.get("userId") ?? null;
}

export async function getAuthenticatedUser(request: Request) {
  const userId = await getUserId(request);
  const user = userId ? await findUserById(userId) : null;

  return user?.emailVerified ? user : null;
}

export async function redirectAuthenticatedUser(request: Request) {
  if (await getAuthenticatedUser(request)) {
    throw redirect("/app");
  }
}

export async function requireUser(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    throw redirect("/auth/login");
  }

  return user;
}

export async function createUserSession(userId: string, redirectTo = "/app") {
  const session = await getSessionStorage().getSession();
  session.set("userId", userId);

  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": await getSessionStorage().commitSession(session),
    },
  });
}

export async function createUserSessionHeaders(userId: string) {
  const session = await getSessionStorage().getSession();
  session.set("userId", userId);
  return {
    "Set-Cookie": await getSessionStorage().commitSession(session),
  };
}

export async function destroyUserSession(request: Request) {
  const session = await getSessionStorage().getSession(
    request.headers.get("Cookie"),
  );

  return redirect("/auth/login", {
    headers: {
      "Set-Cookie": await getSessionStorage().destroySession(session),
    },
  });
}
