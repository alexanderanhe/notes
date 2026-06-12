const requiredVariables = [
  "MONGODB_URI",
  "SESSION_SECRET",
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

  return value;
}

export function validateEnv() {
  for (const variable of requiredVariables) {
    getEnv(variable);
  }
}
