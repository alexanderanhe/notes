import { Resend } from "resend";

import { getEnv } from "./env.server";
import { logSafe } from "~/lib/security.server";

export async function sendVerificationCode(email: string, code: string) {
  const resend = new Resend(getEnv("RESEND_API_KEY"));
  const { error } = await resend.emails.send({
    from: getEnv("RESEND_FROM_EMAIL"),
    to: email,
    subject: "Verifica tu correo",
    text: `Tu código de verificación es ${code}. Expira en 15 minutos.`,
    html: `
      <div style="font-family: sans-serif; color: #18181b">
        <h1 style="font-size: 20px">Verifica tu correo</h1>
        <p>Usa este código para completar tu registro:</p>
        <p style="font-size: 30px; font-weight: 700; letter-spacing: 8px">${code}</p>
        <p>El código expira en 15 minutos.</p>
      </div>
    `,
  });

  if (error) {
    logSafe("error", "verification_email_failed", { provider: "resend", error });
    throw new Error("No fue posible enviar el correo de verificación.");
  }
}
