import { createCookieSessionStorage, redirect } from "react-router";

import { getEnv } from "./env.server";
import { findUserById } from "./users.server";
import type { EncryptedTotpSecret } from "./two-factor.server";

type AuthLevel = "password_verified" | "fully_authenticated";

interface SessionData {
  userId: string;
  authLevel: AuthLevel;
  twoFactorPending: boolean;
  twoFactorVerifiedAt?: string;
  twoFactorAttempts?: number;
  pendingTotp?: EncryptedTotpSecret;
  stepUpRedirectTo?: string;
}

export const recentTwoFactorMaxAgeMs = 10 * 60_000;

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

async function readSession(request: Request) {
  return getSessionStorage().getSession(request.headers.get("Cookie"));
}

function safeRedirectTo(value: string | null | undefined, fallback = "/app") {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const url = new URL(value, "https://notes.invalid");
    return url.origin === "https://notes.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export function isRecentTwoFactorVerification(
  verifiedAt: string | Date | null | undefined,
  maxAgeMs: number,
  now = Date.now(),
) {
  if (!verifiedAt || maxAgeMs < 0) return false;
  const timestamp =
    verifiedAt instanceof Date ? verifiedAt.getTime() : Date.parse(verifiedAt);
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now &&
    now - timestamp <= maxAgeMs
  );
}

export async function getUserId(request: Request) {
  return (await readSession(request)).get("userId") ?? null;
}

export async function getAuthenticatedUser(request: Request) {
  const session = await readSession(request);
  if (session.get("authLevel") !== "fully_authenticated") return null;
  const userId = session.get("userId");
  const user = userId ? await findUserById(userId) : null;
  return user?.emailVerified ? user : null;
}

export async function getPasswordVerifiedUser(request: Request) {
  const session = await readSession(request);
  const userId = session.get("userId");
  const user = userId ? await findUserById(userId) : null;
  return user?.emailVerified ? user : null;
}

export async function redirectAuthenticatedUser(request: Request) {
  const session = await readSession(request);
  if (await getAuthenticatedUser(request)) throw redirect("/app");
  if (
    session.get("twoFactorPending") &&
    (await getPasswordVerifiedUser(request))?.twoFactor?.enabled
  ) {
    throw redirect("/auth/2fa");
  }
}

export async function requireUser(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    const session = await readSession(request);
    throw redirect(session.get("twoFactorPending") ? "/auth/2fa" : "/auth/login");
  }
  return user;
}

export async function requirePendingTwoFactorUser(request: Request) {
  const session = await readSession(request);
  if (!session.get("twoFactorPending")) throw redirect("/auth/login");
  const user = await getPasswordVerifiedUser(request);
  if (!user?.twoFactor?.enabled) throw redirect("/auth/login");
  return user;
}

export async function requireRecent2FA(
  request: Request,
  maxAgeMs = recentTwoFactorMaxAgeMs,
  redirectTo = new URL(request.url).pathname,
) {
  const user = await requireUser(request);
  if (!user.twoFactor?.enabled) {
    throw Response.json(
      { error: "This action requires two-factor authentication." },
      { status: 403 },
    );
  }

  const session = await readSession(request);
  if (
    isRecentTwoFactorVerification(
      session.get("twoFactorVerifiedAt"),
      maxAgeMs,
    )
  ) {
    return user;
  }

  session.set("stepUpRedirectTo", safeRedirectTo(redirectTo));
  throw Response.json(
    {
      error: "Confirm your two-factor authentication to continue.",
      requiresRecent2FA: true,
      confirmUrl: "/auth/2fa/confirm",
    },
    {
      status: 428,
      headers: { "Set-Cookie": await getSessionStorage().commitSession(session) },
    },
  );
}

function setFullAuthentication(session: Awaited<ReturnType<typeof readSession>>, userId: string) {
  session.set("userId", userId);
  session.set("authLevel", "fully_authenticated");
  session.set("twoFactorPending", false);
  session.set("twoFactorVerifiedAt", new Date().toISOString());
  session.unset("twoFactorAttempts");
  session.unset("pendingTotp");
}

export async function createUserSession(userId: string, redirectTo = "/app") {
  const session = await getSessionStorage().getSession();
  setFullAuthentication(session, userId);
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await getSessionStorage().commitSession(session) },
  });
}

export async function createUserSessionHeaders(userId: string) {
  const session = await getSessionStorage().getSession();
  setFullAuthentication(session, userId);
  return { "Set-Cookie": await getSessionStorage().commitSession(session) };
}

export async function createPartialSessionHeaders(userId: string) {
  const session = await getSessionStorage().getSession();
  session.set("userId", userId);
  session.set("authLevel", "password_verified");
  session.set("twoFactorPending", true);
  session.set("twoFactorAttempts", 0);
  return { "Set-Cookie": await getSessionStorage().commitSession(session) };
}

export async function completeTwoFactorHeaders(request: Request) {
  const session = await readSession(request);
  setFullAuthentication(session, session.get("userId")!);
  return { "Set-Cookie": await getSessionStorage().commitSession(session) };
}

export async function completeRecentTwoFactor(request: Request) {
  const session = await readSession(request);
  const redirectTo = safeRedirectTo(session.get("stepUpRedirectTo"), "/app");
  session.set("twoFactorVerifiedAt", new Date().toISOString());
  session.unset("stepUpRedirectTo");
  session.unset("twoFactorAttempts");
  return {
    redirectTo,
    headers: { "Set-Cookie": await getSessionStorage().commitSession(session) },
  };
}

export async function getRecentTwoFactorRedirect(request: Request) {
  const session = await readSession(request);
  return safeRedirectTo(session.get("stepUpRedirectTo"), "/app");
}

export async function recordTwoFactorFailure(request: Request) {
  const session = await readSession(request);
  const attempts = (session.get("twoFactorAttempts") ?? 0) + 1;
  if (attempts >= 5) {
    return {
      locked: true,
      headers: { "Set-Cookie": await getSessionStorage().destroySession(session) },
    };
  }
  session.set("twoFactorAttempts", attempts);
  return {
    locked: false,
    headers: { "Set-Cookie": await getSessionStorage().commitSession(session) },
  };
}

export async function setPendingTotpHeaders(
  request: Request,
  pendingTotp: EncryptedTotpSecret,
) {
  const session = await readSession(request);
  session.set("pendingTotp", pendingTotp);
  return { "Set-Cookie": await getSessionStorage().commitSession(session) };
}

export async function getPendingTotp(request: Request) {
  return (await readSession(request)).get("pendingTotp") ?? null;
}

export async function clearPendingTotpHeaders(request: Request) {
  const session = await readSession(request);
  session.unset("pendingTotp");
  session.set("twoFactorVerifiedAt", new Date().toISOString());
  return { "Set-Cookie": await getSessionStorage().commitSession(session) };
}

export async function destroyUserSession(request: Request) {
  const session = await readSession(request);
  return redirect("/auth/login", {
    headers: { "Set-Cookie": await getSessionStorage().destroySession(session) },
  });
}
