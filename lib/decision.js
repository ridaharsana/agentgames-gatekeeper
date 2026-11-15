// lib/decision.js — deterministic gatekeeper decision logic (no I/O, no LLM).
// Reason codes: Rules Quick Reference wins; event-page aliases in README table.
"use strict";

function toBig(x) {
  if (x === undefined || x === null || x === "") return null;
  try { return BigInt(x); } catch (_) { return null; }
}
function fieldEq(a, b) {
  const ba = toBig(a), bb = toBig(b);
  if (ba !== null && bb !== null) return ba === bb;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

// Check order follows the event page's build checklist, with a missing-data
// guard first. `seen` is a Set of previously presented proof_tx values.
// Returns { decision, reason_code }.
function decide(input, seen) {
  if (!input || typeof input !== "object" ||
      !input.registered_vk || !input.proof_vk || !input.proof_tx) {
    return { decision: "REJECT", reason_code: "MISSING_VERIFICATION" };
  }
  if (!fieldEq(input.proof_vk, input.registered_vk))
    return { decision: "REJECT", reason_code: "VK_SUBSTITUTION" };
  const bal = toBig(input.public_balance), min = toBig(input.minimum);
  if (bal === null || min === null || bal < min)
    return { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" };
  if (!fieldEq(input.recipient, input.condition_recipient))
    return { decision: "REJECT", reason_code: "RECIPIENT_MISMATCH" };
  if (seen.has(input.proof_tx))
    return { decision: "REJECT", reason_code: "PROOF_REPLAY" };
  const cur = toBig(input.current_block), exp = toBig(input.expiry_block);
  if (cur === null || exp === null || cur > exp)
    return { decision: "REJECT", reason_code: "EXPIRED_CONDITION" };
  const amt = toBig(input.amount), cap = toBig(input.max_transfer);
  if (amt === null || cap === null || amt > cap)
    return { decision: "REJECT", reason_code: "AMOUNT_OVERFLOW" };
  return { decision: "APPROVE", reason_code: "VALID_PROOF" };
}

// task_id -> circuit taskId. Platform mapping UNPUBLISHED; heuristic: first
// integer group of the id ("gk_24_9d1" -> 24, matching a public worked example).
function taskIdOf(task_id) {
  const m = String(task_id || "").match(/\d+/);
  return m ? m[0] : "0";
}

module.exports = { decide, taskIdOf, toBig };
