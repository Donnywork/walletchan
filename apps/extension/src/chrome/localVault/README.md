# LocalVault audit domain

A `localVault` account is the public address of a key held by the separate
LocalVault program. WalletChan never holds the key. The account is not a
direct signer, so every shared signing path rejects it; this domain is its
only effect path. Envelope spec: LocalVault `docs/ENVELOPE.md`.

- `policy.ts` is pure: what M1 can send (plain ETH transfers on Sepolia, no
  calldata, replacement or special metadata). The renderer uses it to block
  Confirm early; the background enforces it on both calls.
- `envelope.ts` is pure: builds the v1 `signTransaction` request, strictly
  parses a pasted response, and verifies a signed transaction (canonical
  type-0x02 bytes, unsigned part equal to the request, low-S, recovered
  sender, hash). Same rules as LocalVault's `signer.VerifyResponse`.
- `accountHandlers.ts` owns master-gated `addLocalVaultAccount` (public
  address only, under the wallet-secret lock, like Ledger account import).
- `transactionExecution.ts` owns the two trusted-UI handlers:
  `prepareLocalVaultTransaction` (pending nonce + reviewed gas → unsigned
  bytes, stored in `chrome.storage.session` as `localVaultRequest:{txId}`)
  and `submitLocalVaultResponse` (verify against the stored request, re-check
  chain, nonce and pending-request authorization, remove the pending row,
  write history, broadcast through `localSigning/transactionBroadcast.ts`).

Dependencies point inward: `background/localVaultRouter.ts` →
`accountHandlers.ts` / `transactionExecution.ts` → `envelope.ts` / `policy.ts`. Effects: session
storage, the configured Sepolia RPC, transaction history and `txResult:*`.
Tests: `tests/localVault/`.
