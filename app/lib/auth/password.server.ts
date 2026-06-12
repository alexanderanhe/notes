import bcrypt from "bcryptjs";

const bcryptRounds = 12;

export function hashSecret(value: string) {
  return bcrypt.hash(value, bcryptRounds);
}

export function verifySecret(value: string, hash: string) {
  return bcrypt.compare(value, hash);
}
