// lib/kurier.js — official zkVerify submission flow via Kurier (REST).
// This is the ONLY submission route used ("agents that attempt to submit
// proof verification requests outside the official verification flow will
// be disqualified"). API key is env-only (KURIER_API_KEY); when absent the
// submission is skipped and the caller returns proof with proof_tx null.
"use strict";

const VK_HASH = "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
const BASE = "https://api.kurier.xyz/api/v1";
const POLL_INTERVAL_MS = parseInt(process.env.KURIER_POLL_INTERVAL_MS || "1000", 10);
const POLL_TIMEOUT_MS = parseInt(process.env.KURIER_POLL_TIMEOUT_MS || "20000", 10); // inside the platform's ~30s delivery window

// Returns { proof_tx, status, jobId } — proof_tx null unless the job reaches
// IncludedInBlock/Finalized carrying a tx hash.
// Never throws: failures are reported in `status` so the decision response still goes out.
async function submitAndPoll(proof, publicSignals) {
  const key = process.env.KURIER_API_KEY;
  if (!key) {
    console.error("[kurier] KURIER_API_KEY not set — proof NOT submitted; MISSING_VERIFICATION risk (proof present, proof_tx null)");
    return { proof_tx: null, status: "skipped_no_api_key", jobId: null };
  }
  try {
    const res = await fetch(`${BASE}/submit-proof/${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proofType: "groth16",
        vkRegistered: true,
        proofOptions: { library: "snarkjs", curve: "bn128" },
        proofData: { proof, publicSignals, vk: VK_HASH },
      }),
    });
    const job = await res.json().catch(() => ({}));
    const jobId = job.jobId || job.id || null;
    if (!res.ok || !jobId) {
      console.error("[kurier] submit failed:", res.status, JSON.stringify(job).slice(0, 200));
      return { proof_tx: null, status: "submit_failed_" + res.status, jobId };
    }
    // Poll for the tx hash. MEASURED live 2026-11-15 from the VPS:
    // submit +0.7s -> IncludedInBlock +2.9s WITH txHash -> Finalized +24.9s
    // (same txHash). The platform's delivery timeout is ~30s, so waiting for
    // Finalized blows the response window — the 2026-11-15 practice dispatch
    // was canceled by the platform at ~30s while we were still polling.
    // Return as soon as a tx hash exists; it does not change at Finalized.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let last = job;
    let seenTx = null;
    while (Date.now() < deadline) {
      const status = last.status || last.state || "";
      const tx = last.txHash || last.transactionHash || last.proofTx || null;
      if (tx) seenTx = tx;
      if ((status === "IncludedInBlock" || status === "Finalized") && seenTx) {
        return { proof_tx: seenTx, status, jobId };
      }
      if (status === "Failed" || status === "Error") {
        return { proof_tx: null, status, jobId };
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pr = await fetch(`${BASE}/job-status/${key}/${jobId}`);
      last = await pr.json().catch(() => ({}));
    }
    return { proof_tx: seenTx, status: "poll_timeout_last_" + (last.status || last.state || "unknown"), jobId };
  } catch (e) {
    console.error("[kurier] error:", String(e).slice(0, 200));
    return { proof_tx: null, status: "error", jobId: null };
  }
}

module.exports = { submitAndPoll, VK_HASH };
