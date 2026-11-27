import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_LOCAL_VAULT_MESSAGE_TYPES,
  createBackgroundLocalVaultMessageRouter,
  type BackgroundLocalVaultDependencies,
} from "../../src/chrome/background/localVaultRouter";

function route(message: Record<string, unknown>, overrides: Partial<BackgroundLocalVaultDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: BackgroundLocalVaultDependencies = {
    handleAddLocalVaultAccount: async () => { calls.push("add"); return { id: "lv" }; },
    handlePrepareLocalVaultTransaction: async (txId) => { calls.push(`prepare:${txId}`); return { success: true, envelope: "{}" }; },
    handleSubmitLocalVaultResponse: async (txId) => { calls.push(`submit:${txId}`); return { success: true, txHash: "0x1" }; },
    runPendingRequestResolution: (async (input: { resolve: () => Promise<unknown> }) => {
      calls.push("claim");
      return input.resolve();
    }) as never,
    pendingResolutionConflict: () => ({ success: false, error: "conflict" }),
    ...overrides,
  };
  return new Promise<{ calls: string[]; response: unknown; handled: boolean }>((resolve) => {
    const result = createBackgroundLocalVaultMessageRouter(dependencies)(message, (response) =>
      resolve({ calls, response, handled: true }));
    if (!result.handled) resolve({ calls, response: undefined, handled: false });
  });
}

test("router owns exactly the three LocalVault messages", async () => {
  assert.deepEqual([...BACKGROUND_LOCAL_VAULT_MESSAGE_TYPES], [
    "addLocalVaultAccount", "prepareLocalVaultTransaction", "submitLocalVaultResponse",
  ]);
  assert.equal((await route({ type: "confirmTransactionAsyncPK" })).handled, false);
});

test("add and prepare go straight to their handlers", async () => {
  assert.deepEqual(await route({ type: "addLocalVaultAccount", address: "0x1" }), {
    calls: ["add"], response: { success: true, account: { id: "lv" } }, handled: true,
  });
  assert.deepEqual((await route({ type: "prepareLocalVaultTransaction", txId: "t1" })).calls, ["prepare:t1"]);
});

test("submit claims the pending request before resolving it", async () => {
  const result = await route({ type: "submitLocalVaultResponse", txId: "t1", response: "{}" });
  assert.deepEqual(result.calls, ["claim", "submit:t1"]);
});

test("handler failures, including the master-password gate, become error responses", async () => {
  const result = await route({ type: "addLocalVaultAccount" }, {
    handleAddLocalVaultAccount: async () => { throw new Error("Adding accounts requires master password"); },
  });
  assert.deepEqual(result.response, { success: false, error: "Adding accounts requires master password" });
});
