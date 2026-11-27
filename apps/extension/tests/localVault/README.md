# LocalVault tests

Pure coverage of `src/chrome/localVault/`: the request envelope shape, strict
response parsing, signed-transaction verification (valid key and nonce 0
accepted; another key, changed fields, wrong hash, legacy type and high-s
signatures rejected), the M1 send policy, and the prepare/submit handlers'
refusal paths with mocked storage and RPC, and the router's message
ownership and pending-request claim on submit.
