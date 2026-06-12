import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import {
  AuthLayout,
  Field,
  FormError,
} from "~/components/auth-form";
import { verifySecret } from "~/lib/auth/password.server";
import {
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
  return [{ title: "Iniciar sesión | Notas privadas" }];
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
    return { error: "Correo o contraseña incorrectos.", email };
  }

  if (!user.emailVerified) {
    logSafe("warn", "auth_login_unverified", { requestId: getRequestId(request) });
    return {
      error: "Verifica tu correo antes de iniciar sesión.",
      email,
      needsVerification: true,
    };
  }

  let vault = getUserVaultEnvelope(user);
  if (!vault) {
    const parsedVault = vaultEnvelopeSchema.safeParse(candidateVault);
    if (!parsedVault.success) {
      return { error: "No fue posible preparar la bóveda.", email };
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
  return Response.json(
    {
      success: true as const,
      userId: user._id.toHexString(),
      vault,
    },
    { headers: await createUserSessionHeaders(user._id.toHexString()) },
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
          }
        | { error: string; email?: string; needsVerification?: boolean };

      if (!("success" in result)) {
        setError(result.error);
        setEmail(result.email ?? "");
        setNeedsVerification(Boolean(result.needsVerification));
        return;
      }

      if (!result.vault) {
        setError("La cuenta no contiene una bóveda válida.");
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
          "La contraseña autentica la cuenta, pero no puede descifrar su bóveda. No es posible recuperar notas cifradas sin la contraseña original.",
        );
        return;
      }

      const sessionCheck = await fetch("/api/vault", { redirect: "manual" });
      if (!sessionCheck.ok) {
        setError(
          "La contraseña es correcta, pero el navegador no conservó la sesión. Usa HTTPS o abre la aplicación desde localhost.",
        );
        return;
      }

      try {
        await migrateLegacyNotes(password, masterKey);
      } catch {
        setError(
          "La sesión inició, pero no fue posible migrar las notas antiguas. La contraseña anterior de bóveda podría ser diferente.",
        );
        return;
      }

      try {
        await persistDeviceUnlock(result.userId, masterKey);
      } catch {
        setError(
          "La bóveda abrió, pero el navegador no permitió guardar la recuperación local. Revisa que IndexedDB esté habilitado.",
        );
        return;
      }
      window.location.assign("/app");
    } catch {
      setError("No fue posible completar el inicio de sesión.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <AuthLayout
      title="Inicia sesión"
      description="Accede a tus notas privadas."
      footer={
        <>
          ¿No tienes cuenta?{" "}
          <Link className="font-medium text-blue-600" to="/auth/register">
            Regístrate
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
            Ingresar código de verificación
          </Link>
        ) : null}
        <Field
          label="Correo"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          defaultValue={email}
        />
        <Field
          label="Contraseña"
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <button
          type="submit"
          disabled={working}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
        >
          {working ? "Abriendo bóveda..." : "Iniciar sesión"}
        </button>
      </form>
    </AuthLayout>
  );
}
