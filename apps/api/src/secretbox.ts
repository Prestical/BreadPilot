// Authenticated encryption for the desktop app's files (database snapshot, settings): AES-256-GCM
// with a fresh 12-byte nonce per write. A wrong key or any changed byte makes `openBox` throw, so a
// file is either read exactly as written or not at all.
//
// Layout: magic (5 bytes, also authenticated) | nonce (12) | tag (16) | ciphertext.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const NONCE = 12;
const TAG = 16;
export const KEY_BYTES = 32;

export class BoxError extends Error {
  constructor(
    message: string,
    /** "format" = not this kind of file; "auth" = wrong key or damaged. */
    public reason: "format" | "auth",
  ) {
    super(message);
  }
}

function checkKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) throw new Error(`Encryption key must be ${KEY_BYTES} bytes, got ${key.length}.`);
}

/** `magic` names the kind of file (5 ASCII characters, e.g. "BPDB1"), so files can't be swapped. */
export function sealBox(key: Uint8Array, magic: string, plain: Uint8Array): Buffer {
  checkKey(key);
  const head = Buffer.from(magic, "ascii");
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(head);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([head, nonce, cipher.getAuthTag(), body]);
}

export function openBox(key: Uint8Array, magic: string, box: Uint8Array): Buffer {
  checkKey(key);
  const head = Buffer.from(magic, "ascii");
  const buf = Buffer.from(box.buffer, box.byteOffset, box.byteLength);
  if (buf.length < head.length + NONCE + TAG || !buf.subarray(0, head.length).equals(head)) {
    throw new BoxError(`Not a ${magic} file.`, "format");
  }
  const at = head.length;
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(at, at + NONCE));
  decipher.setAAD(head);
  decipher.setAuthTag(buf.subarray(at + NONCE, at + NONCE + TAG));
  try {
    return Buffer.concat([decipher.update(buf.subarray(at + NONCE + TAG)), decipher.final()]);
  } catch {
    throw new BoxError("The file can't be decrypted: wrong key, or the file is damaged.", "auth");
  }
}
