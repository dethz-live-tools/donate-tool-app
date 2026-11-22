import { createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign, X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_FILE } from "../config.ts";

export interface TlsIdentity {
  cert: string;
  key: string;
  fingerprint: string;
  sanIps: string[];
}

const CERT_FILENAME = "screen-share-cert.pem";
const KEY_FILENAME = "screen-share-key.pem";
const CERT_VALIDITY_DAYS = 365;
const RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(...items: Buffer[]): Buffer {
  return derTag(0x30, Buffer.concat(items));
}

function derSet(...items: Buffer[]): Buffer {
  return derTag(0x31, Buffer.concat(items));
}

function derInteger(bytes: Buffer): Buffer {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const trimmed = bytes.subarray(i);
  const content = trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0x00]), trimmed]) : trimmed;
  return derTag(0x02, content);
}

function derOid(oid: string): Buffer {
  const parts = oid.split(".").map(Number);
  const out: number[] = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const encoded: number[] = [v & 0x7f];
    v >>>= 7;
    while (v > 0) {
      encoded.unshift((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    out.push(...encoded);
  }
  return derTag(0x06, Buffer.from(out));
}

function derBitString(bytes: Buffer, unusedBits = 0): Buffer {
  return derTag(0x03, Buffer.concat([Buffer.from([unusedBits]), bytes]));
}

function derOctetString(bytes: Buffer): Buffer {
  return derTag(0x04, bytes);
}

function derUtf8String(str: string): Buffer {
  return derTag(0x0c, Buffer.from(str, "utf8"));
}

function derTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getUTCFullYear();
  const rest =
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z";
  if (year >= 1950 && year <= 2049) {
    return derTag(0x17, Buffer.from(pad(year % 100) + rest, "ascii"));
  }
  return derTag(0x18, Buffer.from(String(year) + rest, "ascii"));
}

function derExtension(oid: string, value: Buffer, critical = false): Buffer {
  const parts = [derOid(oid)];
  if (critical) parts.push(derTag(0x01, Buffer.from([0xff])));
  parts.push(derOctetString(value));
  return derSequence(...parts);
}

function parseIpv4Bytes(ip: string): Buffer | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    bytes[i] = n;
  }
  return Buffer.from(bytes);
}

function normalizeLanIps(lanIps: string[]): string[] {
  const unique = new Set<string>();
  for (const ip of lanIps) {
    const trimmed = ip.trim();
    if (trimmed && parseIpv4Bytes(trimmed)) {
      unique.add(trimmed);
    }
  }
  return Array.from(unique).sort();
}

function getSafeHostname(): string | null {
  try {
    const host = os.hostname().trim().toLowerCase();
    if (
      host &&
      host !== "localhost" &&
      host.length <= 253 &&
      /^[a-z0-9.-]+$/.test(host) &&
      !parseIpv4Bytes(host)
    ) {
      return host;
    }
  } catch {}
  return null;
}

export function generateSelfSignedCert(lanIps: string[]): TlsIdentity {
  const normalizedIps = normalizeLanIps(lanIps);
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spkiDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  const serial = randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 0x01; // positive non-zero 128-bit serial

  const sigAlg = derSequence(derOid("1.2.840.10045.4.3.2")); // ecdsa-with-SHA256
  const dn = derSequence(derSet(derSequence(derOid("2.5.4.3"), derUtf8String("donate-socket LAN Screen Share"))));

  const now = Date.now();
  const notBefore = new Date(now - 5 * 60 * 1000);
  const notAfter = new Date(now + CERT_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

  const sanEntries: Buffer[] = [derTag(0x82, Buffer.from("localhost", "ascii"))];
  const hostname = getSafeHostname();
  if (hostname) {
    sanEntries.push(derTag(0x82, Buffer.from(hostname, "ascii")));
  }
  sanEntries.push(derTag(0x87, Buffer.from([127, 0, 0, 1])));
  sanEntries.push(derTag(0x87, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])));
  for (const ip of normalizedIps) {
    const bytes = parseIpv4Bytes(ip);
    if (bytes && ip !== "127.0.0.1") {
      sanEntries.push(derTag(0x87, bytes));
    }
  }

  const extensions = derSequence(
    derExtension("2.5.29.19", derSequence(), true), // BasicConstraints CA:FALSE
    derExtension("2.5.29.15", derBitString(Buffer.from([0x80]), 7), true), // KeyUsage: digitalSignature
    derExtension("2.5.29.37", derSequence(derOid("1.3.6.1.5.5.7.3.1")), false), // ExtKeyUsage: serverAuth
    derExtension("2.5.29.17", derSequence(...sanEntries), false) // SubjectAlternativeName
  );

  const tbs = derSequence(
    derTag(0xa0, derInteger(Buffer.from([2]))), // X.509 v3
    derInteger(serial),
    sigAlg,
    dn,
    derSequence(derTime(notBefore), derTime(notAfter)),
    dn,
    spkiDer,
    derTag(0xa3, extensions)
  );

  const signature = sign("sha256", tbs, privateKey);
  const certDer = derSequence(tbs, sigAlg, derBitString(signature));
  const b64Lines = certDer.toString("base64").match(/.{1,64}/g) || [];
  const certPem = `-----BEGIN CERTIFICATE-----\n${b64Lines.join("\n")}\n-----END CERTIFICATE-----\n`;

  const x509 = new X509Certificate(certPem);
  return {
    cert: certPem,
    key: keyPem,
    fingerprint: x509.fingerprint256,
    sanIps: normalizedIps,
  };
}

function isReusableCert(certPem: string, keyPem: string, requiredIps: string[]): TlsIdentity | null {
  try {
    const x509 = new X509Certificate(certPem);
    const privateKey = createPrivateKey(keyPem);
    if (!x509.checkPrivateKey(privateKey)) return null;

    const validFrom = Date.parse(x509.validFrom);
    const validTo = Date.parse(x509.validTo);
    const now = Date.now();
    if (!Number.isFinite(validFrom) || !Number.isFinite(validTo)) return null;
    if (now < validFrom || validTo - now < RENEW_WINDOW_MS) return null;

    const sanTokens = new Set(
      (x509.subjectAltName || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    );
    for (const ip of requiredIps) {
      if (!sanTokens.has(`IP Address:${ip}`)) return null;
    }

    return {
      cert: certPem,
      key: keyPem,
      fingerprint: x509.fingerprint256,
      sanIps: requiredIps,
    };
  } catch {
    return null;
  }
}

function isRegularNonSymlinkFile(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    return !stat.isSymbolicLink() && stat.isFile();
  } catch {
    return false;
  }
}

function writeFileAtomic(filePath: string, content: string, mode: number): void {
  try {
    const existing = fs.lstatSync(filePath);
    if (existing.isSymbolicLink()) {
      fs.unlinkSync(filePath);
    } else if (existing.isDirectory()) {
      throw new Error(`Refusing to overwrite directory at ${filePath}`);
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }

  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, { encoding: "utf-8", flag: "wx", mode });
    try {
      fs.chmodSync(tmpPath, mode);
    } catch {}
    fs.renameSync(tmpPath, filePath);
  } finally {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {}
  }
}

export function loadOrCreateScreenShareTlsCert(
  lanIps: string[],
  certDir: string = path.dirname(CONFIG_FILE)
): TlsIdentity {
  const requiredIps = normalizeLanIps(lanIps);
  const certPath = path.join(certDir, CERT_FILENAME);
  const keyPath = path.join(certDir, KEY_FILENAME);

  if (isRegularNonSymlinkFile(certPath) && isRegularNonSymlinkFile(keyPath)) {
    try {
      const certPem = fs.readFileSync(certPath, "utf-8");
      const keyPem = fs.readFileSync(keyPath, "utf-8");
      const existing = isReusableCert(certPem, keyPem, requiredIps);
      if (existing) {
        return existing;
      }
    } catch {}
  }

  const created = generateSelfSignedCert(requiredIps);
  try {
    fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });
    writeFileAtomic(keyPath, created.key, 0o600);
    writeFileAtomic(certPath, created.cert, 0o644);
  } catch (err) {
    console.warn("[screen-share] Failed to persist self-signed TLS cert (using in-memory cert):", err);
  }
  return created;
}
