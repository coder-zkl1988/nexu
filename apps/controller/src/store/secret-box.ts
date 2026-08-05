import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * At-rest protection for the `secrets` map in `config.json`.
 *
 * WHAT THIS DOES AND DOES NOT DEFEND AGAINST — read before extending it.
 *
 * The controller, the agent runtime, and the user all run as the same OS user,
 * so a key this process can read is a key the agent could read too. This is
 * therefore NOT the control that stops an agent from exfiltrating credentials —
 * that is the runtime guard's read fence (see specs/SECURITY.md).
 *
 * What it does close, and the reason it exists:
 *  - `config.json` was mode 0644, so every other account on the machine could
 *    read channel app secrets. Both the config and the key are now 0600.
 *  - `config.json` gets copied around — support bundles, backups, "paste me
 *    your config" in a bug report. The key lives in a separate file, so a copy
 *    of the config alone no longer carries usable credentials.
 *
 * Values are AES-256-GCM with a per-value random IV, serialized as
 * `enc.v1:<iv>:<tag>:<ciphertext>` in base64url. Anything that does not carry
 * that prefix is treated as a legacy plaintext value and returned as-is, so
 * configs written before this existed keep working and get encrypted on their
 * next write.
 */
const PREFIX = "enc.v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class SecretBox {
  private key: Buffer | null = null;

  constructor(private readonly keyPath: string) {}

  private loadKey(): Buffer {
    if (this.key) return this.key;

    if (existsSync(this.keyPath)) {
      const decoded = Buffer.from(
        readFileSync(this.keyPath, "utf8").trim(),
        "base64",
      );
      if (decoded.length === KEY_BYTES) {
        chmodSync(this.keyPath, 0o600);
        this.key = decoded;
        return decoded;
      }
      // A truncated or corrupt key would silently turn every stored secret
      // into garbage on the next write. Refuse instead.
      throw new Error(`Secret key at ${this.keyPath} is not a 32-byte key`);
    }

    const created = randomBytes(KEY_BYTES);
    mkdirSync(path.dirname(this.keyPath), { recursive: true });
    writeFileSync(this.keyPath, created.toString("base64"), {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(this.keyPath, 0o600);
    this.key = created;
    return created;
  }

  static isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
  }

  encrypt(value: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.loadKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [
      PREFIX.slice(0, -1),
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(":");
  }

  /**
   * Returns the plaintext, or the input unchanged when it is a legacy
   * plaintext value. Throws only when a value claims to be encrypted and is
   * not decryptable — silently returning ciphertext there would ship a broken
   * credential to a channel and look like an upstream auth failure.
   */
  decrypt(value: string): string {
    if (!SecretBox.isEncrypted(value)) return value;
    const [, ivPart, tagPart, dataPart] = value.split(":");
    if (!ivPart || !tagPart || !dataPart) {
      throw new Error("Malformed encrypted secret");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.loadKey(),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  /** Constant-time compare, exposed so callers never hand-roll one. */
  static equals(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
