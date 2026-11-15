# Self-test log — 2026-11-15T04:43:37.462Z

| # | case | expected | got | time | proof | resp sig | result |
|---|------|----------|-----|------|-------|----------|--------|
| 1 | health exact shape | {ok:true,protocolVersion:"v1"} | {"ok":true,"protocolVersion":"v1"} | - | - | - | PASS |
| 2 | preflight | {ok:true,protocolVersion:"v1"} + valid sig | {"ok":true,"protocolVersion":"v1"} | - | - | sig OK | PASS |
| 3 | valid condition | APPROVE/VALID_PROOF | APPROVE/VALID_PROOF | 961 ms | verified OK | sig OK | PASS |
| 4 | VK substitution | REJECT/VK_SUBSTITUTION | REJECT/VK_SUBSTITUTION | 461 ms | verified OK | sig OK | PASS |
| 5 | threshold mismatch | REJECT/THRESHOLD_MISMATCH | REJECT/THRESHOLD_MISMATCH | 316 ms | verified OK | sig OK | PASS |
| 6 | recipient mismatch | REJECT/RECIPIENT_MISMATCH | REJECT/RECIPIENT_MISMATCH | 331 ms | verified OK | sig OK | PASS |
| 7 | amount overflow | REJECT/AMOUNT_OVERFLOW | REJECT/AMOUNT_OVERFLOW | 319 ms | verified OK | sig OK | PASS |
| 8 | expired condition | REJECT/EXPIRED_CONDITION | REJECT/EXPIRED_CONDITION | 241 ms | verified OK | sig OK | PASS |
| 9 | missing verification (no proof_tx) | REJECT/MISSING_VERIFICATION | REJECT/MISSING_VERIFICATION | 44 ms | - | sig OK | PASS |
| 10 | proof replay (resubmit valid) | REJECT/PROOF_REPLAY | REJECT/PROOF_REPLAY | - | - | sig OK | PASS |
| 11 | HMAC failure (bad signature) | HTTP 401 | HTTP 401 | - | - | - | PASS |
| 12 | unsigned request | HTTP 401 | HTTP 401 | - | - | - | PASS |
| 13 | tampered proof rejected by verify | verify false | verify false (correct) | - | verify false (correct) | - | PASS |

**13/13 passed**
