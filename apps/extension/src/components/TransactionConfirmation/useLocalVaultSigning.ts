/**
 * State and background calls for LocalVault copy-paste signing on the
 * single-transaction confirmation screen. The screen is remounted per
 * request (keyed by request id), so state never leaks between requests.
 */
import { useState } from "react";
import type { GasOverrides } from "@/chrome/txHandlers";
import type { PendingTxRequest } from "@/chrome/requests/pendingTxStorage";
import { localVaultUnsupportedReason } from "@/chrome/localVault/policy";

type Result = { success: boolean; error?: string; envelope?: string } | undefined;

function send(message: Record<string, unknown>): Promise<Result> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (result: Result) => {
      const transportError = chrome.runtime.lastError?.message;
      resolve(transportError ? { success: false, error: transportError } : result);
    });
  });
}

export function useLocalVaultSigning(input: {
  enabled: boolean;
  txRequest: PendingTxRequest;
  gasOverrides: GasOverrides | null;
  onSent?: () => void;
}) {
  const [envelope, setEnvelope] = useState<string | null>(null);
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState<"preparing" | "submitting" | null>(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const unsupportedReason = input.enabled ? localVaultUnsupportedReason(input.txRequest) : null;

  const prepare = async () => {
    if (busy) return;
    setBusy("preparing");
    setError("");
    const result = await send({
      type: "prepareLocalVaultTransaction",
      txId: input.txRequest.id,
      ...(input.gasOverrides ? { gasOverrides: input.gasOverrides } : {}),
    });
    setBusy(null);
    if (result?.success && result.envelope) setEnvelope(result.envelope);
    else setError(result?.error || "Failed to create the LocalVault request");
  };

  const submit = async () => {
    if (busy || !response.trim()) return;
    setBusy("submitting");
    setError("");
    const result = await send({
      type: "submitLocalVaultResponse",
      txId: input.txRequest.id,
      response,
    });
    setBusy(null);
    if (!result?.success) {
      setError(result?.error || "Failed to send the transaction");
      return;
    }
    if (input.onSent) input.onSent();
    else {
      setSent(true);
      setTimeout(() => window.close(), 1000);
    }
  };

  const edit = () => {
    setEnvelope(null);
    setResponse("");
    setError("");
  };

  return {
    enabled: input.enabled,
    envelope,
    response,
    setResponse,
    busy,
    error,
    sent,
    unsupportedReason,
    /** Fee and nonce fields must not change once the request is created. */
    locked: !!envelope || busy !== null,
    prepare,
    submit,
    edit,
  };
}


export type LocalVaultSigning = ReturnType<typeof useLocalVaultSigning>;
