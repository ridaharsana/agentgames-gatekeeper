# Proof Gatekeeper agent — zkVerify Agent Games

Competitor account registered (@fahriamj451, zkVerify Agent Games Season 01).
Agent "nezuko" registered for Proof Gatekeeper and **ACTIVE** on the platform
(signed preflight passed 2026-11-15). Deployed on a VPS behind a Cloudflare
tunnel (public HTTPS endpoint, full `/agent` path registered). Rounds 3–8 run
2026-11-15 → 2026-11-20; this repo is the exact code that runs live.

## Structure (per the official starter prompt)

| module | job |
|---|---|
| `agent.js` | transport only: HTTP, raw-body handling, routing |
| `lib/hmac.js` | HMAC-SHA256 over raw body, `x-agent-games-signature` header |
| `lib/decision.js` | deterministic decision logic + reason codes |
| `lib/proof.js` | local Groth16 proof generation (official circuit) |
| `lib/kurier.js` | official zkVerify submission flow via Kurier |
| `probe_signals.js` | evidence tool: probes the wasm for input signal names |
| `selftest.js` | 13-case local test suite → `test/SELFTEST_LOG.md` |

## Run

```bash
npm install                       # project-local only (snarkjs 0.7.6)
cp .env.example .env              # fill AGENT_GAMES_HMAC_SECRET (+ KURIER_API_KEY), export them
node agent.js                     # POST /agent, GET /health on :8791
node selftest.js                  # full local suite
```

Endpoints (register the **full path** `POST /agent` with the platform):

- `GET /health` → exactly `{ ok: true, protocolVersion: "v1" }`
- `POST /agent` type `agent-games.preflight.v1` `{agent_id, issued_at, nonce}`
  → `{ ok: true, protocolVersion: "v1" }` **with a valid response signature** —
  preflight must pass before the platform marks the agent active, and a
  placeholder/absent secret fails it (server refuses to start without a real
  secret unless `ALLOW_UNSIGNED=1` dev flag is set).
- `POST /agent` type `agent-games.proof-gatekeeper.v1` → task handling below.

Every request is HMAC-verified over the **raw body before parsing**; every
response is signed the same way. No staleness rejection: `issued_at` age is
logged only (no limit is stated on the current /build).

## Task flow

1. Verify HMAC → parse → decide (lib/decision.js, deterministic).
2. Generate the Groth16 decision proof locally (lib/proof.js).
3. Submit via the **official Kurier flow only** (lib/kurier.js):
   `POST https://api.kurier.xyz/api/v1/submit-proof/${KURIER_API_KEY}` with
   `{proofType:"groth16", vkRegistered:true, proofOptions:{library:"snarkjs",
   curve:"bn128"}, proofData:{proof, publicSignals, vk:"0x6b79…d77b0"}}`,
   then poll the job status and return as soon as a tx hash exists
   (`IncludedInBlock`, ~3 s — the hash is final-shaped already; `Finalized`
   follows at ~25 s with the same hash, past the platform's ~30 s delivery
   timeout, so it is never awaited in-request).
   Submitting outside this flow = disqualification per the rules.
   No `KURIER_API_KEY` (local dev): decision returns with the proof present,
   `proof_tx: null`, and a MISSING_VERIFICATION risk is logged — never a crash.
4. Response carries **both** documented shapes: `decision`, `reason_code`,
   `proof_tx` (null until a finalized submission exists) **plus** `proof` and
   `public_signals` when available. If proof generation/submission failed:
   `proof: null` + `proof_error` explaining, decision still returned.
   PROOF_REPLAY responses carry no proof (replay tasks are excluded from
   proof submission by the scoring rules).

## Reason codes — trap → code mapping (Rules list wins)

| trap / situation | primary code emitted | alias / notes |
|---|---|---|
| valid condition | `VALID_PROOF` | event page: `VALID_CONDITION` |
| proof VK ≠ registered VK | `VK_SUBSTITUTION` | same in both lists |
| balance < minimum | `THRESHOLD_MISMATCH` | same in both lists |
| proof_tx already seen | `PROOF_REPLAY` | event page: `PROOF_REUSED` — Rules name wins |
| recipient ≠ condition recipient | `RECIPIENT_MISMATCH` | event-page code; a field-vs-proof variant would be `PUBLIC_INPUT_MISMATCH` |
| current block > expiry | `EXPIRED_CONDITION` | event-page code (no Rules equivalent) |
| amount > max transfer | `AMOUNT_OVERFLOW` | event-page code (no Rules equivalent) |
| task missing verification data (no proof_tx / VK fields) | `MISSING_VERIFICATION` | Rules code |
| proof fails verification | `PROOF_INVALID` | Rules code — not emitted by the current flow (we generate, not ingest, proofs); covered by the tampered-proof test |
| wrong circuit / VK-hash family | `CIRCUIT_MISMATCH` | Rules code — reserved; not emitted (task `registered_vk` is a condition VK, not the circuit vkHash, so it is never compared to 0x6b79…d77b0) |
| envelope field ≠ proof public input | `PUBLIC_INPUT_MISMATCH` | Rules code — reserved for a proof-ingesting variant |

Check order in `decide()`: MISSING_VERIFICATION → VK_SUBSTITUTION →
THRESHOLD_MISMATCH → RECIPIENT_MISMATCH → PROOF_REPLAY → EXPIRED_CONDITION →
AMOUNT_OVERFLOW → VALID_PROOF. Seen-set persists in `seen_proof_tx.json`.

Known tension: a MISSING_VERIFICATION reject of an otherwise-valid condition
is **unprovable in-circuit** (the circuit refuses decision=0 for valid
fields), so that response goes out with `proof: null` + `proof_error` —
exactly the shape the schema rule prescribes for a failed proof.

## What is PROVEN locally (artifacts in test/, CIRCUIT.md)

- Official wasm (1,755,820 B, sha256 `be00aefe…264f`) + zkey (309,750 B,
  sha256 `adfe95a4…80d`) — match an independent public record.
- All 13 circuit input names probed directly against the wasm
  (`probe_signals.js`: size=1 each, 10 near-miss controls size=0);
  `salt` is the only private input; public order observed, and public[0] =
  Poseidon(salt, taskId) reproduced bit-for-bit vs a published value.
- **Positive-path gate:** valid-scenario proof generated;
  `snarkjs groth16 verify verification_key.json test/public_valid.json test/proof_valid.json`
  → `[INFO] snarkJS: OK!` (exit 0). Wrong decisions fail witness generation
  (`GatekeeperEvaluation_79 line: 102` assert).
- Self-test **13/13 PASS**: health exact shape, preflight + valid response
  signature, signed valid task, all trap classes, HMAC failure → 401,
  unsigned → 401, replay → PROOF_REPLAY, tampered proof → verify false.
  Response times 241–961 ms (deadline 60 s).
- **Live practice task PASSED (2026-11-15)**: platform verdict
  "CORRECT DECISION" — REJECT / `AMOUNT_OVERFLOW` as expected, proof
  **VERIFIED**, platform latency **4,945 ms**, response carried a real
  `proof_tx`. The first practice attempt exposed the platform's ~30 s
  delivery timeout (see below); the fix is in `lib/kurier.js`.
- **Kurier live submission measured from the deployment host**: submit
  +0.7 s → `IncludedInBlock` +2.9 s **with txHash already present** →
  `Finalized` +24.9 s (same txHash). The agent therefore returns at
  IncludedInBlock; waiting for Finalized (~25 s) is what blew the
  platform's ~30 s delivery window on the first practice attempt.

## What is UNPROVEN / UNKNOWN

1. **task_id → circuit `taskId` mapping** — heuristic (first integer group);
   platform derivation unpublished. Practice task IDs carry no integer
   group, so practice could not test this; it only matters for competition
   tasks, whose proofs the platform checks against the task.
2. **HMAC secret encoding** — raw utf8 assumed and **validated live**
   (signed preflight passed, practice task signature accepted); the hex
   variant (`AGENT_GAMES_HMAC_SECRET_HEX=1`) remains untested.
3. **Response strictness** — we send both documented shapes plus
   `public_signals`/`submission_status`; the practice channel accepted
   them. Whether competition scoring treats any extra field differently
   is unknown.
4. **Salt expectation** — fresh random salt per task; any platform-issued
   salt requirement is unknown.
