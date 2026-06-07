import { customAlphabet } from "nanoid";

// URL-safe alphabet without ambiguous chars (0/O, 1/l/I)
const INVITE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
const INVITE_LENGTH = 10;

const generate = customAlphabet(INVITE_ALPHABET, INVITE_LENGTH);

export function generateInviteCode(): string {
  return generate();
}
