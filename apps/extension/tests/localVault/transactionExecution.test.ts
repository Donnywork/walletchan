import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, parseTransaction, serializeTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PendingTxRequest } from "../../src/chrome/requests/pendingTxStorage";

// Well-known test-only keys (anvil defaults). Never hold real funds.
const vaultKey = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const otherKey = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const from = vaultKey.address;
const gasOverrides = { gasLimit: "25200", maxFeePerGas: "30000000000", maxPriorityFeePerGas: "1500000000" };

const pending = {
  id: "lv-request",
  tx: { from, to: "0x2222222222222222222222222222222222222222", chainId: 11155111, value: "0x2386f26fc10000", data: "0x" },
  origin: "Send ETH",
  favicon: null,
  chainName: "Sepolia",
  timestamp: 1,
  trustedInternal: true,
  accountId: "lv-account",
  accountAddress: from.toLowerCase(),
  accountType: "localVault",
} satisfies PendingTxRequest;

function storageArea(values: Record<string, unknown>) {
  return {
    // Supports both the promise form and the callback form used by session/storage.ts.
    async get(keys?: string | string[] | null, callback?: (items: Record<string, unknown>) => void) {
      const list = keys == null ? Object.keys(values) : [keys].flat();
      const items = Object.fromEntries(list.filter((k) => k in values).map((k) => [k, structuredClone(values[k])]));
      callback?.(items);
      return items;
    },
    async set(next: Record<string, unknown>) { Object.assign(values, structuredClone(next)); },
    async remove(keys: string | string[]) { for (const k of [keys].flat()) delete values[k]; },
  };
}

const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const sync: Record<string, unknown> = {};
const rpcCalls: string[] = [];

function reset(overrides: Partial<PendingTxRequest> = {}) {
  for (const area of [local, session, sync]) for (const k of Object.keys(area)) delete area[k];
  rpcCalls.length = 0;
  local.accounts = [{ id: "lv-account", type: "localVault", address: from.toLowerCase(), createdAt: 1 }];
  local.pendingTxRequests = [{ ...pending, ...overrides }];
}

// Install before importing: the session-storage shim detects the native API at load.
Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    storage: { local: storageArea(local), session: storageArea(session), sync: storageArea(sync), onChanged: { addListener() {} } },
    runtime: { async sendMessage() {}, lastError: undefined },
  },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  const body = JSON.parse(init?.body ?? "{}");
  const reply = (request: { id: number; method: string }) => {
    rpcCalls.push(request.method);
    const result = request.method === "eth_getTransactionCount" ? "0x3"
      : request.method === "eth_chainId" ? "0xaa36a7" : null;
    return { jsonrpc: "2.0", id: request.id, result };
  };
  const payload = Array.isArray(body) ? body.map(reply) : reply(body);
  return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
}) as typeof fetch;
test.after(() => { globalThis.fetch = originalFetch; });

const { handlePrepareLocalVaultTransaction, handleSubmitLocalVaultResponse } = await import(
  "../../src/chrome/localVault/transactionExecution"
);

const storedKey = `localVaultRequest:${pending.id}`;

test("prepare builds the exact unsigned request from the pending nonce and reviewed gas", async () => {
  reset();
  const result = await handlePrepareLocalVaultTransaction(pending.id, gasOverrides);
  assert.equal(result.success, true, JSON.stringify(result));
  const envelope = JSON.parse((result as { envelope: string }).envelope);
  assert.equal(envelope.method, "signTransaction");
  assert.equal(envelope.params.chainId, 11155111);
  assert.equal(envelope.params.from.toLowerCase(), from.toLowerCase());
  const tx = parseTransaction(envelope.params.tx);
  assert.equal(tx.type, "eip1559");
  assert.equal(tx.nonce, 3);
  assert.equal(tx.to, pending.tx.to);
  assert.equal(tx.value, 10_000_000_000_000_000n);
  assert.equal(tx.gas, 25_200n);
  assert.equal(tx.maxFeePerGas, 30_000_000_000n);
  assert.equal(tx.maxPriorityFeePerGas, 1_500_000_000n);
  assert.equal((session[storedKey] as { id: string }).id, envelope.id);
  assert.deepEqual(rpcCalls, ["eth_getTransactionCount"]);
});

test("prepare refuses without reviewed gas, outside M1 policy, or for another account type", async () => {
  reset();
  assert.deepEqual(await handlePrepareLocalVaultTransaction(pending.id), { success: false, error: "Gas fees are not ready yet" });
  reset({ tx: { ...pending.tx, chainId: 1 } });
  assert.match((await handlePrepareLocalVaultTransaction(pending.id, gasOverrides) as { error: string }).error, /Sepolia/);
  reset({ tx: { ...pending.tx, data: "0xa9059cbb" } });
  assert.match((await handlePrepareLocalVaultTransaction(pending.id, gasOverrides) as { error: string }).error, /plain ETH/);
  reset({ accountType: "impersonator" });
  assert.match((await handlePrepareLocalVaultTransaction(pending.id, gasOverrides) as { error: string }).error, /not pinned to a LocalVault/);
  assert.deepEqual(rpcCalls, []);
  assert.equal(session[storedKey], undefined);
});

async function preparedRequest() {
  reset();
  const result = await handlePrepareLocalVaultTransaction(pending.id, gasOverrides);
  const envelope = JSON.parse((result as { envelope: string }).envelope);
  return { id: envelope.id as string, unsignedTx: envelope.params.tx as Hex };
}

async function responseFor(id: string, unsignedTx: Hex, signer = vaultKey) {
  const signedTx = await signer.signTransaction(parseTransaction(unsignedTx) as never);
  return JSON.stringify({ v: 1, id, result: { signedTx, hash: keccak256(signedTx) } });
}

function assertNothingBroadcast() {
  assert.equal((local.pendingTxRequests as unknown[]).length, 1, "pending request must remain");
  assert.equal(rpcCalls.includes("eth_sendRawTransaction"), false);
}

test("submit refuses when no request was prepared", async () => {
  reset();
  const { unsignedTx } = await preparedRequest();
  delete session[storedKey];
  const result = await handleSubmitLocalVaultResponse(pending.id, await responseFor("x", unsignedTx));
  assert.match((result as { error: string }).error, /Request expired/);
  assertNothingBroadcast();
});

test("submit refuses a response for a different request id", async () => {
  const { unsignedTx } = await preparedRequest();
  const result = await handleSubmitLocalVaultResponse(pending.id, await responseFor("someotherid", unsignedTx));
  assert.match((result as { error: string }).error, /different request/);
  assertNothingBroadcast();
});

test("submit refuses a signature from another key and a changed transaction", async () => {
  const { id, unsignedTx } = await preparedRequest();
  let result = await handleSubmitLocalVaultResponse(pending.id, await responseFor(id, unsignedTx, otherKey));
  assert.match((result as { error: string }).error, /different address/);
  const changed = serializeTransaction({ ...parseTransaction(unsignedTx), value: 1n } as never);
  result = await handleSubmitLocalVaultResponse(pending.id, await responseFor(id, changed));
  assert.match((result as { error: string }).error, /does not match the requested transaction/);
  assertNothingBroadcast();
});

test("submit refuses garbage and vault error responses", async () => {
  const { id } = await preparedRequest();
  assert.match((await handleSubmitLocalVaultResponse(pending.id, "hello") as { error: string }).error, /not valid JSON/);
  const rejected = JSON.stringify({ v: 1, id, error: { code: "rejected", message: "User rejected the request" } });
  assert.match((await handleSubmitLocalVaultResponse(pending.id, rejected) as { error: string }).error, /User rejected/);
  assertNothingBroadcast();
});

test("submit refuses when the account nonce moved and drops the stale request", async () => {
  const { id, unsignedTx } = await preparedRequest();
  (session[storedKey] as { nonce: number }).nonce = 2; // chain now reports 3
  const result = await handleSubmitLocalVaultResponse(pending.id, await responseFor(id, unsignedTx));
  assert.match((result as { error: string }).error, /nonce changed/);
  assert.equal(session[storedKey], undefined, "stale request is dropped");
  assertNothingBroadcast();
});
