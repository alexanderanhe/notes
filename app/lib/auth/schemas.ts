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

