import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, isEncryptionKeyConfigured } from "./encryption";

const firstKey = Buffer.alloc(32, 1).toString("base64");
const secondKey = Buffer.alloc(32, 2).toString("hex");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI credential encryption", () => {
  it("round-trips credentials without storing plaintext", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", firstKey);
    const credential = "provider-secret";

    const encrypted = encryptSecret(credential);

    expect(encrypted).not.toContain(credential);
    expect(encrypted.split(":")[0]).toBe("v1");
    expect(decryptSecret(encrypted)).toBe(credential);
  });

  it("uses a fresh nonce for each encryption", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", firstKey);

    expect(encryptSecret("same credential")).not.toBe(
      encryptSecret("same credential"),
    );
  });

  it("rejects malformed or tampered envelopes", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", firstKey);
    const encrypted = encryptSecret("provider-secret");
    const [version, nonce, tag, ciphertext] = encrypted.split(":");
    const replacement = ciphertext?.startsWith("A") ? "B" : "A";

    expect(() => decryptSecret("v2:bad:envelope")).toThrow(
      "unsupported encryption envelope",
    );
    expect(() =>
      decryptSecret(`${version}:${nonce}:${tag}:${replacement}${ciphertext?.slice(1)}`),
    ).toThrow();
  });

  it("rejects missing and malformed keys and ciphertext encrypted under a rotated key", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "");
    expect(isEncryptionKeyConfigured()).toBe(false);

    vi.stubEnv("APP_ENCRYPTION_KEY", "not-a-valid-key");
    expect(isEncryptionKeyConfigured()).toBe(false);

    vi.stubEnv("APP_ENCRYPTION_KEY", firstKey);
    const encrypted = encryptSecret("provider-secret");
    vi.stubEnv("APP_ENCRYPTION_KEY", secondKey);
    expect(isEncryptionKeyConfigured()).toBe(true);
    expect(() => decryptSecret(encrypted)).toThrow();
  });

  it("accepts exactly 32-byte hexadecimal and base64 keys", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("hex"));
    expect(isEncryptionKeyConfigured()).toBe(true);

    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64"));
    expect(isEncryptionKeyConfigured()).toBe(true);
  });
});
