export const verificationCodeLifetimeMs = 15 * 60 * 1000;
export const verificationEmailCooldownMs = 60 * 1000;
export const maximumVerificationAttempts = 5;

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function validatePassword(password: string) {
  if (password.length < 8) {
    return "La contraseña debe tener al menos 8 caracteres.";
  }

  if (password.length > 72) {
    return "La contraseña no puede superar 72 caracteres.";
  }

  return null;
}

export function isValidVerificationCode(code: string) {
  return /^\d{6}$/.test(code);
}
