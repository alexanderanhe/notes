import { z } from "zod";

import { isVaultEnvelope } from "~/lib/vault";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Ingresa un correo válido.")
  .max(254, "Ingresa un correo válido.");

export const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres.")
  .max(72, "La contraseña no puede superar 72 caracteres.");

export const verificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Ingresa un código válido.");

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Ingresa un código de 6 dígitos.");

export const backupCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/, "Ingresa un código de respaldo válido.");

export const twoFactorVerifySchema = z.object({
  code: z.union([totpCodeSchema, backupCodeSchema]),
});

export const totpOnlySchema = z.object({ code: totpCodeSchema });

export const securityPreferencesSchema = z.object({
  require2FAForExport: z.boolean(),
  require2FAForPasswordChange: z.boolean(),
  require2FAForCriticalNotes: z.boolean(),
});

export const themePreferenceSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
});

export const vaultEnvelopeSchema = z.custom<ReturnType<typeof parseVaultFields>>(
  isVaultEnvelope,
  "Envelope de bóveda inválido.",
);

export function parseVaultFields(formData: FormData) {
  return {
    encryptedMasterKey: String(formData.get("encryptedMasterKey") ?? ""),
    masterKeyIv: String(formData.get("masterKeyIv") ?? ""),
    kdfSalt: String(formData.get("kdfSalt") ?? ""),
    iterations: Number(formData.get("iterations")),
    encryptionVersion: Number(formData.get("encryptionVersion")),
  };
}

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: verificationCodeSchema,
});
