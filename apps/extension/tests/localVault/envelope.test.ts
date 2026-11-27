import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, serializeTransaction, type Hex, type TransactionSerializableEIP1559 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildSignTransactionRequest,
  createLocalVaultRequestId,
  parseLocalVaultResponse,
  verifyLocalVaultSignedTransaction,
} from "../../src/chrome/localVault/envelope";
import { localVaultUnsupportedReason } from "../../src/chrome/localVault/policy";

// Well-known test-only keys (anvil defaults). Never hold real funds.
const vaultKey = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const otherKey = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

const tx: TransactionSerializableEIP1559 = {
  type: "eip1559",
  chainId: 11155111,
  nonce: 0,
  to: "0x1111111111111111111111111111111111111111",
  value: 10_000_000_000_000_000n,
  gas: 25_200n,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 1_500_000_000n,
  data: "0x",
};
const unsignedTx = serializeTransaction(tx);

async function signedResponse(signer = vaultKey, transaction = tx) {
  const signedTx = await signer.signTransaction(transaction);
  return { signedTx, hash: keccak256(signedTx) };
}

test("request envelope matches the v1 shape", () => {
  const id = createLocalVaultRequestId();
  assert.match(id, /^[0-9a-f]{32}$/);
  const text = buildSignTransactionRequest({ id, chainId: 11155111, from: vaultKey.address, unsignedTx });
  assert.equal(text.includes("\n"), false);
  assert.deepEqual(JSON.parse(text), {
    v: 1,
    id,
    method: "signTransaction",
    params: { chainId: 11155111, from: vaultKey.address, tx: unsignedTx },
  });
});

test("accepts a response signed by the expected key for the exact request (nonce 0)", async () => {
  const { signedTx, hash } = await signedResponse();
  await verifyLocalVaultSignedTransaction({ unsignedTx, from: vaultKey.address, signedTx, hash });
  // Address case must not matter.
  await verifyLocalVaultSignedTransaction({ unsignedTx, from: vaultKey.address.toLowerCase(), signedTx, hash });
});

test("accepts a non-zero nonce", async () => {
  const withNonce = { ...tx, nonce: 7 };
  const { signedTx, hash } = await signedResponse(vaultKey, withNonce);
  await verifyLocalVaultSignedTransaction({ unsignedTx: serializeTransaction(withNonce), from: vaultKey.address, signedTx, hash });
});

test("rejects a signature from a different key", async () => {
  const { signedTx, hash } = await signedResponse(otherKey);
  await assert.rejects(
    verifyLocalVaultSignedTransaction({ unsignedTx, from: vaultKey.address, signedTx, hash }),
    /different address/,
  );
});

test("rejects a signed transaction that differs from the request", async () => {
  for (const changed of [
    { ...tx, to: "0x2222222222222222222222222222222222222222" as const },
    { ...tx, value: tx.value! + 1n },
    { ...tx, nonce: 1 },
    { ...tx, maxFeePerGas: tx.maxFeePerGas! + 1n },
  ]) {
    const { signedTx, hash } = await signedResponse(vaultKey, changed);
    await assert.rejects(
      verifyLocalVaultSignedTransaction({ unsignedTx, from: vaultKey.address, signedTx, hash }),
      /does not match the requested transaction/,
    );
  }
});

test("rejects a wrong hash and a legacy transaction", async () => {
  const { signedTx } = await signedResponse();
  await assert.rejects(
    verifyLocalVaultSignedTransaction({ unsignedTx, from: vaultKey.address, signedTx, hash: keccak256("0x01") }),
    /hash does not match/,
  );
  const legacy = await vaultKey.signTransaction({
    type: "legacy", chainId: 11155111, nonce: 0, to: tx.to, value: tx.value, gas: tx.gas, gasPrice: tx.maxFeePerGas,
  });
  await assert.rejects(
    verifyLocalVaultSignedTransaction({ unsignedTx, from: vaultKey.address, signedTx: legacy, hash: keccak256(legacy) }),
    /not an EIP-1559/,
  );
});

test("rejects a high-s (malleable) signature", async () => {
  const { signedTx } = await signedResponse();
  const { parseTransaction } = await import("viem");
  const parsed = parseTransaction(signedTx);
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = `0x${(n - BigInt(parsed.s!)).toString(16).padStart(64, "0")}` as Hex;
  const fields = { ...parsed };
  delete fields.r; delete fields.s; delete fields.v; delete fields.yParity;
  const flipped = serializeTransaction(fields, { r: parsed.r!, s: highS, yParity: parsed.yParity === 0 ? 1 : 0 });
  await assert.rejects(
    verifyLocalVaultSignedTransaction({ unsignedTx, from: vaultKey.address, signedTx: flipped, hash: keccak256(flipped) }),
    /high s/,
  );
});

test("parses a success response strictly", async () => {
  const { signedTx, hash } = await signedResponse();
  const text = `  ${JSON.stringify({ v: 1, id: "abc_123-X", result: { signedTx, hash } })}\n`;
  assert.deepEqual(parseLocalVaultResponse(text), { kind: "result", id: "abc_123-X", signedTx, hash });
});

test("parses an error response", () => {
  assert.deepEqual(
    parseLocalVaultResponse('{"v":1,"id":"7f3c9a01","error":{"code":"rejected","message":"User rejected the request"}}'),
    { kind: "error", id: "7f3c9a01", code: "rejected", message: "User rejected the request" },
  );
});

test("rejects malformed responses", async () => {
  const { signedTx, hash } = await signedResponse();
  const bad = [
    "",
    "not json",
    "[]",
    JSON.stringify({ v: 2, id: "a", result: { signedTx, hash } }),
    JSON.stringify({ v: 1, id: "a b", result: { signedTx, hash } }),
    JSON.stringify({ v: 1, id: "a", result: { signedTx, hash }, extra: 1 }),
    JSON.stringify({ v: 1, id: "a", result: { signedTx, hash, extra: 1 } }),
    JSON.stringify({ v: 1, id: "a" }),
    JSON.stringify({ v: 1, id: "a", result: { signedTx, hash }, error: { code: "x", message: "y" } }),
    JSON.stringify({ v: 1, id: "a", result: { signedTx: "0xabc", hash } }),
    JSON.stringify({ v: 1, id: "a", result: { signedTx, hash: "0x1234" } }),
    JSON.stringify({ v: 1, id: "a", result: null }),
    "x".repeat(40_000),
  ];
  for (const text of bad) assert.throws(() => parseLocalVaultResponse(text), undefined, text.slice(0, 80));
});

test("M1 policy allows only plain Sepolia ETH transfers", () => {
  const base = { tx: { from: vaultKey.address, to: tx.to!, value: "0x1", data: "0x", chainId: 11155111 } };
  assert.equal(localVaultUnsupportedReason(base), null);
  assert.equal(localVaultUnsupportedReason({ tx: { ...base.tx, data: undefined } }), null);
  assert.match(localVaultUnsupportedReason({ tx: { ...base.tx, chainId: 1 } })!, /Sepolia/);
  assert.match(localVaultUnsupportedReason({ tx: { ...base.tx, data: "0xa9059cbb" } })!, /plain ETH/);
  assert.match(localVaultUnsupportedReason({ tx: { ...base.tx, to: null } })!, /deploy/);
  assert.match(
    localVaultUnsupportedReason({
      ...base,
      replacement: { kind: "cancel", originalTxId: "a", originalTxHash: "0x", nonce: 1, minimumMaxFeePerGas: "1", minimumMaxPriorityFeePerGas: "1" },
    })!,
    /Speed-up and cancel/,
  );
});
