# Gatekeeper circuit — evidence record

Official artifacts (downloaded 2026-11-15 from agentgames.zkverify.io/circuits):

| file | bytes | sha256 |
|---|---|---|
| gatekeeper.wasm | 1,755,820 | `be00aefe3c8ba910951a242f50e55937bf82a0375ad4b69c2ef10629ab92764f` |
| gatekeeper_final.zkey | 309,750 | `adfe95a439a7063a82a4967ef026d2dd6857a4d02c63b3caf63dac02e01af80d` |

Both sizes and both hashes match the values published independently by
@saifulsidik801 (Medium, 2026-11-15). Verification key exported locally:
`snarkjs zkey export verificationkey` → protocol groth16, curve bn128,
nPublic 13, IC length 14, witness size 647, circom version 2.2.3 (wasm exports).

## Input signals (13) — independently probed, not just copied

Method: `probe_signals.js` instantiates the wasm, computes the FNV-1a-64 hash
of each candidate name (same function as circom_runtime), and calls the wasm's
exported `getInputSignalSize(hMSB, hLSB)`. `getInputSize()` = 13.

| # (declaration order per @saifulsidik801's probe table) | signal | probe size | role |
|---|---|---|---|
| 1 | `taskId` | 1 | binds proof to one task |
| 2 | `minimum` | 1 | required minimum balance |
| 3 | `publicBalance` | 1 | balance disclosed in the proof |
| 4 | `expiryBlock` | 1 | condition expiry (block height) |
| 5 | `currentBlock` | 1 | block height now |
| 6 | `recipient` | 1 | where the money would go |
| 7 | `conditionRecipient` | 1 | where the condition says it must go |
| 8 | `amount` | 1 | requested payment |
| 9 | `maxTransfer` | 1 | single-transfer cap |
| 10 | `registeredVkHash` | 1 | VK the condition registered |
| 11 | `proofVkHash` | 1 | VK the proof actually used |
| 12 | `salt` | 1 | **private** nonce (only private input) |
| 13 | `decision` | 1 | 1 = approve, 0 = reject |

Negative controls (all probe size 0): `task_id`, `public_balance`,
`max_transfer`, `registered_vk`, `proofTx`, `proof_tx`, `vkHash`, `balance`,
`decisionHash`, `nonce`. Cross-source agreement: @dickycan42 (Medium,
2026-11-14) lists the same 13 names (different order in prose).

## Public signals order (observed from test/public_valid.json)

`[commitment, registeredVkHash, proofVkHash, minimum, publicBalance,
expiryBlock, currentBlock, recipient, conditionRecipient, amount,
maxTransfer, decision, taskId]`

- `commitment` = circuit output = **Poseidon(salt, taskId)**. Confirmed
  independently here: with salt=987654321, taskId=24, our generated
  public[0] = `4538591768452999874275481926009620849813943225939850916630922448132760538048`,
  exactly the value @saifulsidik801 published for Poseidon([987654321, 24]).
- Note: 256-bit VK hashes / addresses are reduced mod the BN128 field prime
  inside the witness (observed: fed decimal of 0x6b79…d77b0, public signal
  shows the reduced value; both VK signals reduce identically).

## Circuit semantics (proven by execution, test/ files)

The circuit enforces **decision == computed verdict**: approve iff every
check passes (VK equal, balance ≥ minimum, recipient matches, not expired,
amount ≤ cap). A wrong decision has no witness:

- valid fields + decision=0 → `Assert Failed. Error in template GatekeeperEvaluation_79 line: 102`, exit 1
- recipient mismatch + decision=1 → same assert, exit 1
- recipient mismatch + decision=0 → proof generates and verifies OK
- valid fields + decision=1 → proof (808 bytes) verifies: `snarkjs groth16 verify` → `[INFO] snarkJS: OK!`, exit 0
