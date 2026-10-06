const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

/** `hr1.` + 32 random bytes (43 base64url chars). */
export const randomToken = (): string => 'hr1.' + b64url(randomBytes(32));

/** 128-bit random id, base64url (22 chars). */
export const randomTicket = (): string => b64url(randomBytes(16));

/** Unbiased only when alphabet.length divides 256 (RECOVERY_ALPHABET has 32 chars). */
export function randomCode(alphabet: string, n: number): string {
  if (256 % alphabet.length !== 0) throw new Error('alphabet length must divide 256');
  const bytes = randomBytes(n);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

export const uuid = (): string => crypto.randomUUID();

export async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
