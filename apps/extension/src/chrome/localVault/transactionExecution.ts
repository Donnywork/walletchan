/**
 * LocalVault copy-paste signing for one pending transaction, in two calls:
 *
 * 1. prepare: build the exact unsigned EIP-1559 transaction (nonce, gas,
 *    fees), keep it in session storage, and return the request envelope.
 * 2. submit: verify the pasted response against that stored request,
 *    re-check chain and nonce, then broadcast through the shared raw path.
 *
 * Signing can take minutes, longer than an MV3 worker may live, so the
 * prepared request is stored instead of held in memory. It contains no
 * secret. The private key never enters WalletChan.
 */
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  serializeTransaction,
  type Hex,
  type TransactionSerializableEIP1559,
} from "viem";
import { RPC_URLS, VIEM_CHAINS } from "@/constants/chainRegistry";
import { getStoredResolvedChainById } from "@/lib/chains";
import { getAccountById } from "../accountStorage";
import { attachClearSignedMetaToHistory } from "../clearSignedMetaSnapshot";
import { startReceiptPolling } from "../forceInclusion/receiptPoller";
import { broadcastSerializedTransaction } from "../localSigner";
import { enforcePendingRequestAuthorizationAtConfirmation } from "../requests/pendingRequestLifecycle";
import {
  beginPendingRequestEffectLease,
  guardPendingRequestEffectLease,
} from "../requests/pendingRequestResolution";
import {
  getPendingTxRequestById,
  removePendingTxRequest,
  type PendingTxRequest,
} from "../requests/pendingTxStorage";
import {
  getSessionItems,
  removeSessionItems,
  setSessionItems,
} from "../session/storage";
import { handleTransactionFailure } from "../transactions/failure";
import type { GasOverrides } from "../transactions/localExecution";
import { processingTxIds, writeResultToStorage } from "../transactions/runtime";
import { addTxToHistory, updateTxInHistory } from "../txHistoryStorage";
import type { LocalVaultAccount } from "../types";
import {
  buildSignTransactionRequest,
  createLocalVaultRequestId,
  parseLocalVaultResponse,
  verifyLocalVaultSignedTransaction,
} from "./envelope";
import { localVaultUnsupportedReason } from "./policy";

type PrepareResult =
  | { success: true; envelope: string }
  | { success: false; error: string };
type SubmitResult =
  | { success: true; txHash: string }
  | { success: false; error: string };

interface StoredLocalVaultRequest {
  version: 1;
  id: string;
  txId: string;
  accountId: string;
  from: string;
  chainId: number;
  nonce: number;
  unsignedTx: Hex;
  gasOverrides: GasOverrides;
}

const requestKey = (txId: string) => `localVaultRequest:${txId}`;

async function readStoredRequest(txId: string): Promise<StoredLocalVaultRequest | null> {
  const key = requestKey(txId);
  const stored = (await getSessionItems<StoredLocalVaultRequest>(key))[key];
  return stored && stored.version === 1 && stored.txId === txId ? stored : null;
}

/** Shared checks for both calls: pinned LocalVault account and M1 policy. */
async function loadLocalVaultPending(
  txId: string,
): Promise<
  | { ok: true; pending: PendingTxRequest; account: LocalVaultAccount }
  | { ok: false; error: string }
> {
  const pending = await getPendingTxRequestById(txId);
  if (!pending) return { ok: false, error: "Transaction request not found" };
  if (pending.accountType !== "localVault" || !pending.accountId) {
    return { ok: false, error: "Transaction is not pinned to a LocalVault account" };
  }
  const account = await getAccountById(pending.accountId);
  if (
    !account ||
    account.type !== "localVault" ||
    account.address.toLowerCase() !== pending.accountAddress?.toLowerCase() ||
    account.address.toLowerCase() !== pending.tx.from.toLowerCase()
  ) {
    return { ok: false, error: "Pending request account is no longer available" };
  }
  const unsupported = localVaultUnsupportedReason(pending);
  if (unsupported) return { ok: false, error: unsupported };
  return { ok: true, pending, account };
}

async function resolveRpc(chainId: number) {
  const resolved = await getStoredResolvedChainById(chainId);
  const rpcUrl = resolved?.rpcUrl || RPC_URLS[chainId];
  const chain = VIEM_CHAINS[chainId];
  if (!rpcUrl || !chain) throw new Error(`No RPC configured for chain ${chainId}`);
  return { chain, rpcUrl };
}

export async function handlePrepareLocalVaultTransaction(
  txId: string,
  gasOverrides?: GasOverrides,
): Promise<PrepareResult> {
  try {
    // The review screen's fee picker always supplies the reviewed gas values.
    if (!gasOverrides) return { success: false, error: "Gas fees are not ready yet" };
    const loaded = await loadLocalVaultPending(txId);
    if (!loaded.ok) return { success: false, error: loaded.error };
    const { pending, account } = loaded;
    const authorization = await enforcePendingRequestAuthorizationAtConfirmation(
      "transaction",
      pending,
    );
    if (!authorization.authorized) return { success: false, error: authorization.error };

    const { chain, rpcUrl } = await resolveRpc(pending.tx.chainId);
    const from = getAddress(account.address);
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000 }) });
    const nonce = await publicClient.getTransactionCount({ address: from, blockTag: "pending" });
    const unsigned: TransactionSerializableEIP1559 = {
      type: "eip1559",
      chainId: pending.tx.chainId,
      nonce,
      to: getAddress(pending.tx.to!),
      value: BigInt(pending.tx.value || "0"),
      data: "0x",
      gas: BigInt(gasOverrides.gasLimit),
      maxFeePerGas: BigInt(gasOverrides.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(gasOverrides.maxPriorityFeePerGas),
      accessList: [],
    };
    // Also rejects a priority fee above the max fee.
    const unsignedTx = serializeTransaction(unsigned);
    const id = createLocalVaultRequestId();
    const stored: StoredLocalVaultRequest = {
      version: 1,
      id,
      txId,
      accountId: account.id,
      from,
      chainId: pending.tx.chainId,
      nonce,
      unsignedTx,
      gasOverrides,
    };
    await setSessionItems({ [requestKey(txId)]: stored });
    return {
      success: true,
      envelope: buildSignTransactionRequest({ id, chainId: stored.chainId, from, unsignedTx }),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to prepare LocalVault request",
    };
  }
}

export async function handleSubmitLocalVaultResponse(
  txId: string,
  responseText: unknown,
): Promise<SubmitResult> {
  if (processingTxIds.has(txId)) {
    return { success: false, error: "Transaction already being processed" };
  }
  processingTxIds.add(txId);
  let effectGuard: ReturnType<typeof guardPendingRequestEffectLease> | null = null;
  let requestCommitted = false;
  let publishedTxHash: string | null = null;
  let pendingForFailure: PendingTxRequest | null = null;
  try {
    const loaded = await loadLocalVaultPending(txId);
    if (!loaded.ok) return { success: false, error: loaded.error };
    const { pending, account } = loaded;
    pendingForFailure = pending;
    const stored = await readStoredRequest(txId);
    if (!stored || stored.accountId !== account.id ||
        stored.from.toLowerCase() !== account.address.toLowerCase() ||
        stored.chainId !== pending.tx.chainId) {
      return { success: false, error: "Request expired. Click Edit, then Confirm to create a new one." };
    }

    // 1. The response must answer this request and carry a valid signature.
    const response = parseLocalVaultResponse(
      typeof responseText === "string" ? responseText : "",
    );
    if (response.id !== stored.id) {
      return { success: false, error: "This response belongs to a different request" };
    }
    if (response.kind === "error") {
      return { success: false, error: `LocalVault returned an error: ${response.message || response.code}` };
    }
    await verifyLocalVaultSignedTransaction({
      unsignedTx: stored.unsignedTx,
      from: stored.from,
      signedTx: response.signedTx,
      hash: response.hash,
    });

    // 2. Re-check chain and nonce right before broadcasting.
    const { chain, rpcUrl } = await resolveRpc(stored.chainId);
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000 }) });
    const [rpcChainId, currentNonce] = await Promise.all([
      publicClient.getChainId(),
      publicClient.getTransactionCount({ address: getAddress(stored.from), blockTag: "pending" }),
    ]);
    if (rpcChainId !== stored.chainId) {
      return { success: false, error: "The selected RPC is not on Sepolia" };
    }
    if (currentNonce !== stored.nonce) {
      await removeSessionItems(requestKey(txId));
      return {
        success: false,
        error: "The account nonce changed since this request was created. Click Edit, then Confirm to create a new one.",
      };
    }
    const authorization = await enforcePendingRequestAuthorizationAtConfirmation(
      "transaction",
      pending,
    );
    if (!authorization.authorized) return { success: false, error: authorization.error };

    // 3. Cross the terminal boundary, then broadcast the exact signed bytes.
    const effectLease = beginPendingRequestEffectLease("transaction", txId);
    if (!effectLease) return { success: false, error: "Wallet reset is in progress" };
    effectGuard = guardPendingRequestEffectLease(effectLease);
    await removePendingTxRequest(txId);
    requestCommitted = true;
    await removeSessionItems(requestKey(txId)).catch(() => undefined);
    const gas = stored.gasOverrides;
    await addTxToHistory({
      id: txId,
      status: "processing",
      tx: {
        ...pending.tx,
        nonce: stored.nonce,
        gas: gas.gasLimit,
        gasPrice: undefined,
        maxFeePerGas: gas.maxFeePerGas,
        maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
      },
      origin: pending.origin,
      favicon: pending.favicon,
      chainName: pending.chainName,
      chainId: pending.tx.chainId,
      createdAt: pending.timestamp,
      accountType: "localVault",
      accountId: pending.accountId,
    });
    void attachClearSignedMetaToHistory(
      txId,
      { ...pending.tx, to: pending.tx.to ?? undefined },
      pending.tx.chainId,
    );
    const walletClient = createWalletClient({ chain, transport: http(rpcUrl, { timeout: 30_000 }) });
    effectGuard.beginEffect();
    const result = await broadcastSerializedTransaction(walletClient as never, response.signedTx, {
      chainId: stored.chainId,
      supportsSyncSend: false,
    });
    effectGuard.settleEffect();
    publishedTxHash = result.txHash;
    await updateTxInHistory(txId, {
      status: "pending",
      txHash: result.txHash,
      broadcastUncertain: result.broadcastUncertain === true,
    });
    startReceiptPolling(txId, result.txHash, stored.chainId);
    await writeResultToStorage(`txResult:${txId}`, { success: true, txHash: result.txHash });
    return { success: true, txHash: result.txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "LocalVault transaction failed";
    effectGuard?.settleEffect();
    if (publishedTxHash) {
      // Broadcast already happened; only bookkeeping failed.
      console.error("[localVault-transaction] Post-broadcast history update failed", error);
      await writeResultToStorage(`txResult:${txId}`, { success: true, txHash: publishedTxHash });
      return { success: true, txHash: publishedTxHash };
    }
    if (requestCommitted && pendingForFailure) {
      await handleTransactionFailure(txId, pendingForFailure, message);
    }
    return { success: false, error: message };
  } finally {
    effectGuard?.releaseIfSafe();
    processingTxIds.delete(txId);
  }
}
