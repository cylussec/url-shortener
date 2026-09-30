const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const CODE_LENGTH = 9;
// Largest multiple of 62 below 256; bytes >= this are rejected to avoid modulo bias.
const REJECT_AT = 256 - (256 % ALPHABET.length);

export const CODE_PATTERN = `[A-Za-z0-9]{${CODE_LENGTH}}`;

export const shortcode = {
  generate(): string {
    let out = "";
    while (out.length < CODE_LENGTH) {
      const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2));
      for (const b of bytes) {
        if (b >= REJECT_AT) continue;
        out += ALPHABET[b % ALPHABET.length];
        if (out.length === CODE_LENGTH) break;
      }
    }
    return out;
  },
};
