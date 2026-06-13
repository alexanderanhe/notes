import { z } from "zod";

import { isVaultEnvelope } from "~/lib/vault";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email.")
  .max(254, "Enter a valid email.");

export const passwordSchema = z
  .string()
  .min(8, "The password must be at least 8 characters.")
  .max(72, "The password cannot exceed 72 characters.");

export const verificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter a valid code.");

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter a 6-digit code.");

export const backupCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/, "Enter a valid backup code.");

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

export const backgroundPreferenceSchema = z.object({
  backgroundUrl: z
    .string()
    .trim()
    .max(2_048)
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "images.unsplash.com";
      } catch {
        return false;
      }
    }, "Use a valid images.unsplash.com URL.")
    .transform((value) => value || null),
});

export const vaultEnvelopeSchema = z.custom<ReturnType<typeof parseVaultFields>>(
  isVaultEnvelope,
  "Invalid vault envelope.",
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
