import bcrypt from "bcryptjs";

const bcryptRounds = 12;

export function hashSecret(value: string, rounds = bcryptRounds) {
  return bcrypt.hash(value, rounds);
}

export function verifySecret(value: string, hash: string) {
  return bcrypt.compare(value, hash);
}
