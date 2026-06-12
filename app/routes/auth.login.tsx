import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import {
  AuthLayout,
  Field,
  FormError,
} from "~/components/auth-form";
import { verifySecret } from "~/lib/auth/password.server";
import {
  createPartialSessionHeaders,
  createUserSessionHeaders,
  redirectAuthenticatedUser,
} from "~/lib/auth/session.server";
import {
  findUserByEmail,
  getUserVaultEnvelope,
  normalizeEmail,
  setUserVaultEnvelope,
} from "~/lib/auth/users.server";
import { loginSchema, parseVaultFields, vaultEnvelopeSchema } from "~/lib/auth/schemas";
import {
  assertSameOrigin,
  enforceRateLimit,
  getRequestId,
  logSafe,
} from "~/lib/security.server";
import {
  createVaultEnvelope,
  migrateLegacyNotes,
  openVaultEnvelope,
  persistDeviceUnlock,
} from "~/lib/vault.client";

import type { Route } from "./+types/auth.login";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Sign in | Notes" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (!new URL(request.url).searchParams.has("reauth")) {
    await redirectAuthenticatedUser(request);
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  const formData = await request.formData();
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  enforceRateLimit(request, {
    bucket: "login",
    limit: 10,
    windowMs: 15 * 60_000,
    identifier: email,
  });
  const password = parsed.success ? parsed.data.password : "";
  const candidateVault = parseVaultFields(formData);
  const user = parsed.success ? await findUserByEmail(parsed.data.email) : null;

  if (!user || !(await verifySecret(password, user.passwordHash))) {
    logSafe("warn", "auth_login_failed", { requestId: getRequestId(request) });
    return { error: "Incorrect email or password.", email };
  }

  if (!user.emailVerified) {
    logSafe("warn", "auth_login_unverified", { requestId: getRequestId(request) });
    return {
      error: "Verify your email before signing in.",
      email,
      needsVerification: true,
    };
  }

  let vault = getUserVaultEnvelope(user);
  if (!vault) {
    const parsedVault = vaultEnvelopeSchema.safeParse(candidateVault);
    if (!parsedVault.success) {
      return { error: "The vault could not be prepared.", email };
    }
    if (!(await setUserVaultEnvelope(user._id, parsedVault.data))) {
      const refreshedUser = await findUserByEmail(email);
      vault = refreshedUser ? getUserVaultEnvelope(refreshedUser) : null;
    } else {
      vault = parsedVault.data;
    }
  }

  logSafe("info", "auth_login_succeeded", {
    requestId: getRequestId(request),
    userId: user._id.toHexString(),
  });
  const twoFactorPending = user.twoFactor?.enabled === true;
  return Response.json(
    {
      success: true as const,
      userId: user._id.toHexString(),
      vault,
      twoFactorPending,
    },
    {
      headers: twoFactorPending
        ? await createPartialSessionHeaders(user._id.toHexString())
        : await createUserSessionHeaders(user._id.toHexString()),
    },
  );
}

export default function Login() {
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [working, setWorking] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNeedsVerification(false);
    setWorking(true);
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");

    try {
      const candidate = await createVaultEnvelope(password);
      for (const [key, value] of Object.entries(candidate.envelope)) {
        formData.set(key, String(value));
      }
      const response = await fetch("/api/auth/login", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as
        | {
            success: true;
            userId: string;
            vault: ReturnType<typeof getUserVaultEnvelope>;
            twoFactorPending: boolean;
          }
        | { error: string; email?: string; needsVerification?: boolean };

      if (!("success" in result)) {
        setError(result.error);
        setEmail(result.email ?? "");
        setNeedsVerification(Boolean(result.needsVerification));
        return;
      }

      if (!result.vault) {
        setError("The account does not contain a valid vault.");
        return;
      }

      let masterKey: CryptoKey;
      try {
        masterKey =
          result.vault.encryptedMasterKey === candidate.envelope.encryptedMasterKey
            ? candidate.masterKey
            : await openVaultEnvelope(password, result.vault);
      } catch {
        setError(
          "The password authenticates the account but cannot decrypt its vault. Encrypted notes cannot be recovered without the original password.",
        );
        return;
      }

      try {
        await persistDeviceUnlock(result.userId, masterKey);
      } catch {
        setError(
          "The vault opened, but the browser could not save local recovery data. Make sure IndexedDB is enabled.",
        );
        return;
      }

      if (result.twoFactorPending) {
        window.location.assign("/auth/2fa");
        return;
      }

      const sessionCheck = await fetch("/api/vault", { redirect: "manual" });
      if (!sessionCheck.ok) {
        setError(
          "The password is correct, but the browser did not preserve the session. Use HTTPS or open the application from localhost.",
        );
        return;
      }

      try {
        await migrateLegacyNotes(password, masterKey);
      } catch {
        setError(
          "The session started, but older notes could not be migrated. The previous vault password may be different.",
        );
        return;
      }
      window.location.assign("/app");
    } catch {
      setError("Sign in could not be completed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Access your private notes."
      footer={
        <>
          Don't have an account?{" "}
          <Link className="font-medium text-blue-600" to="/auth/register">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <FormError message={error} />
        {needsVerification ? (
          <Link
            className="block text-sm font-medium text-blue-600"
            to={`/auth/verify-email?email=${encodeURIComponent(email)}`}
          >
            Enter verification code
          </Link>
        ) : null}
        <Field
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          defaultValue={email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <button
          type="submit"
          disabled={working}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
        >
          {working ? "Opening vault..." : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}
