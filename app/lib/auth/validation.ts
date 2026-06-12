export const verificationCodeLifetimeMs = 15 * 60 * 1000;
export const verificationEmailCooldownMs = 60 * 1000;
export const maximumVerificationAttempts = 5;

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function validatePassword(password: string) {
  if (password.length < 8) {
    return "The password must be at least 8 characters.";
  }

  if (password.length > 72) {
    return "The password cannot exceed 72 characters.";
  }

  return null;
}

export function isValidVerificationCode(code: string) {
  return /^\d{6}$/.test(code);
}
