import { Link } from "react-router";

import {
  AuthForm,
  AuthLayout,
  Field,
  FormError,
} from "~/components/auth-form";
import { verifySecret } from "~/lib/auth/password.server";
import {
  createUserSession,
  redirectAuthenticatedUser,
} from "~/lib/auth/session.server";
import {
  findUserByEmail,
  incrementVerificationAttempts,
  markEmailVerified,
  normalizeEmail,
} from "~/lib/auth/users.server";
import { verifyEmailSchema } from "~/lib/auth/schemas";
import { maximumVerificationAttempts } from "~/lib/auth/validation";
import {
  assertSameOrigin,
  enforceRateLimit,
  getRequestId,
  logSafe,
} from "~/lib/security.server";

import type { Route } from "./+types/auth.verify-email";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Verificar correo | Notas privadas" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await redirectAuthenticatedUser(request);
  return { email: new URL(request.url).searchParams.get("email") ?? "" };
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request);
  const formData = await request.formData();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const code = String(formData.get("code") ?? "").trim();
  enforceRateLimit(request, {
    bucket: "verify_email",
    limit: 10,
    windowMs: 15 * 60_000,
    identifier: email,
  });
  if (!verifyEmailSchema.safeParse({ email, code }).success) {
    return { error: "Ingresa un correo y código válidos.", email };
  }

  const user = await findUserByEmail(email);
  if (!user || user.emailVerified || !user.verificationCodeHash) {
    return { error: "El código no es válido.", email };
  }

  if (
    !user.verificationCodeExpiresAt ||
    user.verificationCodeExpiresAt.getTime() < Date.now()
  ) {
    return { error: "El código expiró. Regístrate nuevamente.", email };
  }

  if (user.verificationAttempts >= maximumVerificationAttempts) {
    return {
      error: "Superaste el límite de intentos. Regístrate nuevamente.",
      email,
    };
  }

  if (!(await verifySecret(code, user.verificationCodeHash))) {
    await incrementVerificationAttempts(user);
    logSafe("warn", "email_verification_failed", {
      requestId: getRequestId(request),
      userId: user._id.toHexString(),
    });
    return { error: "El código no es válido.", email };
  }

  if (!(await markEmailVerified(user))) {
    return { error: "No fue posible verificar el correo.", email };
  }

  logSafe("info", "email_verification_succeeded", {
    requestId: getRequestId(request),
    userId: user._id.toHexString(),
  });
  return createUserSession(user._id.toHexString());
}

export default function VerifyEmail({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  return (
    <AuthLayout
      title="Verifica tu correo"
      description="Ingresa el código de 6 dígitos que enviamos a tu correo."
      footer={
        <Link className="font-medium text-blue-600" to="/auth/register">
          Volver al registro
        </Link>
      }
    >
      <AuthForm submitLabel="Verificar correo">
        <FormError message={actionData?.error} />
        <Field
          label="Correo"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          defaultValue={actionData?.email ?? loaderData.email}
        />
        <Field
          label="Código"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
        />
      </AuthForm>
    </AuthLayout>
  );
}
