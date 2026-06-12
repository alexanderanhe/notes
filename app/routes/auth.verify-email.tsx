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
  return [{ title: "Verify email | Notes" }];
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
    return { error: "Enter a valid email and code.", email };
  }

  const user = await findUserByEmail(email);
  if (!user || user.emailVerified || !user.verificationCodeHash) {
    return { error: "The code is invalid.", email };
  }

  if (
    !user.verificationCodeExpiresAt ||
    user.verificationCodeExpiresAt.getTime() < Date.now()
  ) {
    return { error: "The code expired. Sign up again.", email };
  }

  if (user.verificationAttempts >= maximumVerificationAttempts) {
    return {
      error: "You exceeded the attempt limit. Sign up again.",
      email,
    };
  }

  if (!(await verifySecret(code, user.verificationCodeHash))) {
    await incrementVerificationAttempts(user);
    logSafe("warn", "email_verification_failed", {
      requestId: getRequestId(request),
      userId: user._id.toHexString(),
    });
    return { error: "The code is invalid.", email };
  }

  if (!(await markEmailVerified(user))) {
    return { error: "The email could not be verified.", email };
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
      title="Verify your email"
      description="Enter the 6-digit code we sent to your email."
      footer={
        <Link className="font-medium text-blue-600" to="/auth/register">
          Back to sign up
        </Link>
      }
    >
      <AuthForm submitLabel="Verify email">
        <FormError message={actionData?.error} />
        <Field
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          defaultValue={actionData?.email ?? loaderData.email}
        />
        <Field
          label="Code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
        />
      </AuthForm>
    </AuthLayout>
  );
}
