import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ENVELOPE_VERSION = "v1";
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;

function encryptionKey(): Buffer {
  const configuredKey = process.env.APP_ENCRYPTION_KEY;
  if (!configuredKey) {
    throw new Error(
      "APP_ENCRYPTION_KEY is required to store or use encrypted credentials.",
    );
  }

  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(configuredKey)) {
    key = Buffer.from(configuredKey, "hex");
  } else {
    const unpaddedKey = configuredKey.replace(/=+$/, "");
    if (!/^[A-Za-z0-9+/]{43}=?$/.test(configuredKey)) {
      throw new Error(
        "APP_ENCRYPTION_KEY must be a 32-byte hexadecimal or base64 value.",
      );
    }
    key = Buffer.from(configuredKey, "base64");
    if (key.toString("base64").replace(/=+$/, "") !== unpaddedKey) {
      throw new Error(
        "APP_ENCRYPTION_KEY must be a 32-byte hexadecimal or base64 value.",
      );
    }
  }

  if (key.length !== 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or 64 hexadecimal characters).",
    );
  }
  return key;
}

export function isEncryptionKeyConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) {
    throw new Error("Cannot encrypt an empty credential.");
  }
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    nonce.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(envelope: string): string {
  const [version, nonceEncoded, tagEncoded, ciphertextEncoded, ...extra] =
    envelope.split(":");
  if (
    version !== ENVELOPE_VERSION ||
    !nonceEncoded ||
    !tagEncoded ||
    !ciphertextEncoded ||
    extra.length > 0
  ) {
    throw new Error("Stored credential has an unsupported encryption envelope.");
  }

  const nonce = Buffer.from(nonceEncoded, "base64");
  const tag = Buffer.from(tagEncoded, "base64");
  const ciphertext = Buffer.from(ciphertextEncoded, "base64");
  if (
    nonce.length !== AES_GCM_NONCE_BYTES ||
    tag.length !== AES_GCM_TAG_BYTES ||
    ciphertext.length === 0
  ) {
    throw new Error("Stored credential has an invalid encryption envelope.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
