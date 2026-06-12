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
    throw new Error(`Falta la variable de entorno ${name}.`);
  }

  if (name === "SESSION_SECRET" && value.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
  }

  if (
    name === "TOTP_ENCRYPTION_KEY" &&
    !/^[a-fA-F0-9]{64}$/.test(value) &&
    Buffer.from(value, "base64").length !== 32
  ) {
    throw new Error(
      "TOTP_ENCRYPTION_KEY debe ser una clave de 32 bytes en base64 o hex.",
    );
  }

  return value;
}

export function validateEnv() {
  for (const variable of requiredVariables) {
    getEnv(variable);
  }
}
