import { Resend } from "resend";

import { getEnv } from "./env.server";
import { logSafe } from "~/lib/security.server";

export async function sendVerificationCode(email: string, code: string) {
  const resend = new Resend(getEnv("RESEND_API_KEY"));
  const { error } = await resend.emails.send({
    from: getEnv("RESEND_FROM_EMAIL"),
    to: email,
    subject: "Verify your email",
    text: `Your verification code is ${code}. It expires in 15 minutes.`,
    html: `
      <div style="font-family: sans-serif; color: #18181b">
        <h1 style="font-size: 20px">Verify your email</h1>
        <p>Use this code to complete your registration:</p>
        <p style="font-size: 30px; font-weight: 700; letter-spacing: 8px">${code}</p>
        <p>The code expires in 15 minutes.</p>
      </div>
    `,
  });

  if (error) {
    logSafe("error", "verification_email_failed", { provider: "resend", error });
    throw new Error("The verification email could not be sent.");
  }
}
