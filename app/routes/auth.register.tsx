import { randomInt } from "node:crypto";

import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import {
  AuthLayout,
  Field,
  FormError,
} from "~/components/auth-form";
import { sendVerificationCode } from "~/lib/auth/email.server";
import { hashSecret } from "~/lib/auth/password.server";
import { redirectAuthenticatedUser } from "~/lib/auth/session.server";
import {
  canSendVerificationEmail,
  findUserByEmail,
  normalizeEmail,
  upsertUnverifiedUser,
} from "~/lib/auth/users.server";
import { registerSchema, parseVaultFields, vaultEnvelopeSchema } from "~/lib/auth/schemas";
import {
  verificationCodeLifetimeMs,
  verificationEmailCooldownMs,
} from "~/lib/auth/validation";
import {
  assertSameOrigin,
  enforceRateLimit,
  formatValidationError,
} from "~/lib/security.server";
import {
  createVaultEnvelope,
  persistDeviceUnlock,
} from "~/lib/vault.client";

import type { Route } from "./+types/auth.register";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Crear cuenta | Notas privadas" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await redirectAuthenticatedUser(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  enforceRateLimit(request, { bucket: "register", limit: 5, windowMs: 15 * 60_000 });
  const formData = await request.formData();
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!parsed.success) return { error: formatValidationError(parsed.error), email };
  const { password } = parsed.data;
  const vault = vaultEnvelopeSchema.safeParse(parseVaultFields(formData));
  if (!vault.success) return { error: "No fue posible preparar la bóveda.", email };

  const existing = await findUserByEmail(email);
  if (existing?.emailVerified) {
    return { error: "Ya existe una cuenta con este correo.", email };
  }
  if (!canSendVerificationEmail(existing, verificationEmailCooldownMs)) {
    return { error: "Espera un minuto antes de solicitar otro código.", email };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const [passwordHash, verificationCodeHash] = await Promise.all([
    hashSecret(password),
    hashSecret(code),
  ]);

  const user = await upsertUnverifiedUser({
    email,
    passwordHash,
    verificationCodeHash,
    verificationCodeExpiresAt: new Date(
      Date.now() + verificationCodeLifetimeMs,
    ),
    vault: vault.data,
  });
  await sendVerificationCode(email, code);

  return {
    success: true as const,
    userId: user!._id.toHexString(),
    redirectTo: `/auth/verify-email?email=${encodeURIComponent(email)}`,
  };
}

export default function Register() {
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setWorking(true);
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");

    try {
      const { envelope, masterKey } = await createVaultEnvelope(password);
      for (const [key, value] of Object.entries(envelope)) {
        formData.set(key, String(value));
      }
      const response = await fetch("/api/auth/register", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as
        | { success: true; userId: string; redirectTo: string }
        | { error: string; email?: string };

      if (!("success" in result)) {
        setError(result.error);
        setEmail(result.email ?? "");
        return;
      }

      await persistDeviceUnlock(result.userId, masterKey);
      window.location.assign(result.redirectTo);
    } catch {
      setError("No fue posible crear la cuenta.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <AuthLayout
      title="Crea tu cuenta"
      description="Te enviaremos un código para verificar tu correo."
      footer={
        <>
          ¿Ya tienes cuenta?{" "}
          <Link className="font-medium text-blue-600" to="/auth/login">
            Inicia sesión
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <FormError message={error} />
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
          autoComplete="new-password"
        />
        <button
          type="submit"
          disabled={working}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
        >
          {working ? "Preparando bóveda..." : "Crear cuenta"}
        </button>
      </form>
    </AuthLayout>
  );
}
