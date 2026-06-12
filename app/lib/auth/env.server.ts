const requiredVariables = [
  "MONGODB_URI",
  "SESSION_SECRET",
  "TOTP_ENCRYPTION_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
] as const;

type RequiredVariable = (typeof requiredVariables)[number];

export function getEnv(name: RequiredVariable) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable ${name}.`);
  }

  if (name === "SESSION_SECRET" && value.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }

  if (
    name === "TOTP_ENCRYPTION_KEY" &&
    !/^[a-fA-F0-9]{64}$/.test(value) &&
    Buffer.from(value, "base64").length !== 32
  ) {
    throw new Error(
      "TOTP_ENCRYPTION_KEY must be a 32-byte base64 or hex key.",
    );
  }

  return value;
}

export function validateEnv() {
  for (const variable of requiredVariables) {
    getEnv(variable);
  }
}
