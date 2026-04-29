import { customAlphabet } from "nanoid";

const TOKEN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
const TOKEN_LENGTH = 12;

const generator = customAlphabet(TOKEN_ALPHABET, TOKEN_LENGTH);

export function generateToken(): string {
  return generator();
}
