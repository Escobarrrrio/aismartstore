// Cryptographically-random password generator + a lightweight strength
// heuristic. No external dependency (zxcvbn etc.) -- this only needs to be
// good enough to steer people away from "password1" and reward length.

const LOWER = "abcdefghijkmnpqrstuvwxyz"; // no l/o -- easy to misread
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
const DIGITS = "23456789"; // no 0/1
const SYMBOLS = "!@#$%^&*-_+=?";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

const randomChar = (pool: string) => pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length];

/** Shuffle in place using Fisher-Yates with crypto randomness. */
const shuffle = <T,>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/** Generates a 16-character password guaranteed to contain at least one
 *  lowercase, uppercase, digit and symbol character. */
export const generateStrongPassword = (length = 16): string => {
  const required = [randomChar(LOWER), randomChar(UPPER), randomChar(DIGITS), randomChar(SYMBOLS)];
  const rest = Array.from({ length: Math.max(0, length - required.length) }, () => randomChar(ALL));
  return shuffle([...required, ...rest]).join("");
};

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string };

/** Rough strength estimate from length + character-class variety. Not a
 *  substitute for a real dictionary/entropy check, but enough to nudge
 *  people toward longer, mixed-character passwords. */
export const estimatePasswordStrength = (password: string): PasswordStrength => {
  if (!password) return { score: 0, label: "" };
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (classes >= 3) score++;
  if (password.length >= 14 && classes >= 4) score++;
  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
  return { score: score as PasswordStrength["score"], label: labels[score] };
};
