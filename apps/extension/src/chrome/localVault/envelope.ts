/**
 * LocalVault envelope v1 (WalletChan side). Spec: localvault/docs/ENVELOPE.md.
 *
 * WalletChan builds a `signTransaction` request around unsigned EIP-1559
 * bytes, the user carries it to LocalVault and back, and WalletChan accepts
 * the response only after checking that the signed transaction is exactly
 * the one requested and was signed by the expected address.
 */
import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  serializeTransaction,
  type Hex,
} from "viem";

export const LOCAL_VAULT_ENVELOPE_VERSION = 1;
export const LOCAL_VAULT_MAX_ENVELOPE_BYTES = 32_768;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_BYTES_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
// secp256k1 group order / 2: signatures with a larger `s` are malleable.
const SECP256K1_HALF_N =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

export function createLocalVaultRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildSignTransactionRequest(input: {
  id: string;
  chainId: number;
  from: string;
  unsignedTx: Hex;
}): string {
  return JSON.stringify({
    v: LOCAL_VAULT_ENVELOPE_VERSION,
    id: input.id,
    method: "signTransaction",
    params: {
      chainId: input.chainId,
      from: input.from,
      tx: input.unsignedTx.toLowerCase(),
    },
  });
}

export type LocalVaultResponse =
  | { kind: "result"; id: string; signedTx: Hex; hash: Hex }
  | { kind: "error"; id: string; code: string; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unknown field "${key}" in ${where}`);
    }
  }
}

/**
 * Strictly parses a pasted response envelope. Duplicate JSON keys can't be
 * detected after JSON.parse, but they can't change the outcome either: every
 * accepted value is checked cryptographically against the request.
 */
export function parseLocalVaultResponse(text: string): LocalVaultResponse {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Paste the signed response from LocalVault");
  if (new TextEncoder().encode(trimmed).length > LOCAL_VAULT_MAX_ENVELOPE_BYTES) {
    throw new Error("Response is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Response is not valid JSON. Copy the whole line LocalVault printed.");
  }
  if (!isPlainObject(parsed)) throw new Error("Response must be a JSON object");
  if (parsed.v !== LOCAL_VAULT_ENVELOPE_VERSION) {
    throw new Error("Unsupported LocalVault envelope version");
  }
  assertExactKeys(parsed, ["v", "id", "result", "error"], "response");
  if (typeof parsed.id !== "string" || !ID_PATTERN.test(parsed.id)) {
    throw new Error("Response has an invalid id");
  }
  const hasResult = parsed.result !== undefined;
  const hasError = parsed.error !== undefined;
  if (hasResult === hasError) {
    throw new Error("Response must contain exactly one of result or error");
  }
  if (hasError) {
    const error = parsed.error;
    if (!isPlainObject(error)) throw new Error("Response error must be an object");
    assertExactKeys(error, ["code", "message"], "error");
    if (typeof error.code !== "string" || typeof error.message !== "string") {
      throw new Error("Response error is malformed");
    }
    return {
      kind: "error",
      id: parsed.id,
      code: error.code.slice(0, 64),
      message: error.message.slice(0, 500),
    };
  }
  const result = parsed.result;
  if (!isPlainObject(result)) throw new Error("Response result must be an object");
  assertExactKeys(result, ["signedTx", "hash"], "result");
  if (typeof result.signedTx !== "string" || !HEX_BYTES_PATTERN.test(result.signedTx)) {
    throw new Error("Response signedTx is not valid hex");
  }
  if (typeof result.hash !== "string" || !HASH_PATTERN.test(result.hash)) {
    throw new Error("Response hash is not a 32-byte hex value");
  }
  return {
    kind: "result",
    id: parsed.id,
    signedTx: result.signedTx.toLowerCase() as Hex,
    hash: result.hash.toLowerCase() as Hex,
  };
}

/**
 * Accepts a signed transaction only if all of these hold (same rules as the
 * reference verifier `signer.VerifyResponse` / `lvtool verify`):
 * canonical type-0x02 encoding, unsigned part byte-identical to the request,
 * low-S signature recovering to `from`, and `hash` = keccak256(signedTx).
 */
export async function verifyLocalVaultSignedTransaction(input: {
  unsignedTx: Hex;
  from: string;
  signedTx: Hex;
  hash: Hex;
}): Promise<void> {
  const signedTx = input.signedTx.toLowerCase() as Hex;
  let parsed: ReturnType<typeof parseTransaction>;
  try {
    parsed = parseTransaction(signedTx);
  } catch {
    throw new Error("Signed transaction can't be decoded");
  }
  if (parsed.type !== "eip1559") {
    throw new Error("Signed transaction is not an EIP-1559 transaction");
  }
  if (parsed.r === undefined || parsed.s === undefined || parsed.yParity === undefined) {
    throw new Error("Signed transaction has no signature");
  }
  const { r, s, v: _v, yParity, ...unsignedFields } = parsed;
  void _v;
  if (serializeTransaction(unsignedFields, { r, s, yParity }).toLowerCase() !== signedTx) {
    throw new Error("Signed transaction encoding is not canonical");
  }
  if (serializeTransaction(unsignedFields).toLowerCase() !== input.unsignedTx.toLowerCase()) {
    throw new Error("Signed transaction does not match the requested transaction");
  }
  if (BigInt(s) > SECP256K1_HALF_N) {
    throw new Error("Signature is not canonical (high s)");
  }
  const sender = await recoverTransactionAddress({ serializedTransaction: signedTx as never });
  if (sender.toLowerCase() !== input.from.toLowerCase()) {
    throw new Error("Transaction was signed by a different address than this account");
  }
  if (keccak256(signedTx).toLowerCase() !== input.hash.toLowerCase()) {
    throw new Error("Response hash does not match the signed transaction");
  }
}
