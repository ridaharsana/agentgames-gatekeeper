// agent.js — TRANSPORT ONLY: HTTP server, raw-body handling, routing.
// HMAC -> lib/hmac.js | decision -> lib/decision.js | proof -> lib/proof.js
// Kurier submission -> lib/kurier.js
// Plain HTTP; terminate TLS in a reverse proxy (platform requires public HTTPS).
// Register the FULL handler path with the platform (POST /agent), not root.
//
// Env: PORT (8791), AGENT_GAMES_HMAC_SECRET, KURIER_API_KEY,
//      ALLOW UNSIGNED=1 (dev only, only when no secret is set), SEEN_FILE
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const hmac = require("./lib/hmac");
const { decide } = require("./lib/decision");
const { prove } = require("./lib/proof");
const { submitAndPoll } = require("./lib/kurier");

const PORT = parseInt(process.env.PORT || "8791", 10);
const SEEN_FILE = process.env.SEEN_FILE || path.join(__dirname, "seen_proof_tx.json");
const SECRET = hmac.loadSecret();
const UNSIGNED_OK = !SECRET && process.env.ALLOW_UNSIGNED === "1";
if (!SECRET && !UNSIGNED_OK) {
  console.error("FATAL: AGENT_GAMES_HMAC_SECRET not set and ALLOW_UNSIGNED!=1 — refusing to start (fail closed).");
  process.exit(1);
}
if (UNSIGNED_OK) console.error("WARNING: DEV MODE — HMAC verification DISABLED. A placeholder/absent secret FAILS platform preflight.");

// persistent seen-set for proof replay detection
let seen = new Set();
try { seen = new Set(JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"))); } catch (_) {}
function markSeen(tx) {
  if (!tx || seen.has(tx)) return;
  seen.add(tx);
  try { fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen], null, 2)); } catch (e) { console.error("seen persist failed:", e.message); }
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8"); // fixed key order = deterministic
  const headers = { "content-type": "application/json", "content-length": body.length };
  if (SECRET) headers[hmac.SIG_HEADER] = hmac.sign(SECRET, body); // sign EVERY response over its raw body
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  // HEALTH — exact shape required by the platform.
  if (req.method === "GET" && url === "/health") {
    return sendJson(res, 200, { ok: true, protocolVersion: "v1" });
  }
  if (req.method !== "POST" || url !== "/agent") return sendJson(res, 404, { error: "not found" });

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks);
    // HMAC over the RAW body, BEFORE parsing (fail closed).
    if (!UNSIGNED_OK && !hmac.verify(SECRET, raw, req.headers[hmac.SIG_HEADER])) {
      return sendJson(res, 401, { error: "bad signature" });
    }
    let msg;
    try { msg = JSON.parse(raw.toString("utf8")); } catch (_) {
      return sendJson(res, 400, { error: "invalid json" });
    }
    // PREFLIGHT — platform marks the agent active only if this answers with a
    // valid response signature. Fields: agent_id, issued_at, nonce.
    if (msg && msg.type === "agent-games.preflight.v1") {
      // No staleness rejection is specified on /build — log age only.
      const age = msg.issued_at ? Math.round((Date.now() - new Date(msg.issued_at).getTime()) / 1000) : null;
      console.log(`[preflight] agent_id=${msg.agent_id || "?"} nonce=${msg.nonce || "?"} issued_at_age=${age === null ? "?" : age + "s"}`);
      return sendJson(res, 200, { ok: true, protocolVersion: "v1" });
    }
    if (!msg || msg.type !== "agent-games.proof-gatekeeper.v1" || !msg.input) {
      return sendJson(res, 400, { error: "unsupported type" });
    }
    if (msg.issued_at) { // log staleness, never hard-reject on it
      const age = Math.round((Date.now() - new Date(msg.issued_at).getTime()) / 1000);
      if (Number.isFinite(age)) console.log(`[task] ${msg.task_id} issued_at_age=${age}s`);
    }
    const input = msg.input;
    const verdict = decide(input, seen);
    const replay = verdict.reason_code === "PROOF_REPLAY";
    // Proof: generate locally, then submit via the official Kurier flow.
    // PROOF_REPLAY tasks are excluded from proof submission by the scoring rules.
    let proof = null, publicSignals = null, proofTx = null, proofError = null, submitStatus = null;
    if (!replay) {
      try {
        ({ proof, publicSignals } = await prove(msg, input, verdict));
        const sub = await submitAndPoll(proof, publicSignals);
        proofTx = sub.proof_tx; submitStatus = sub.status;
      } catch (e) {
        proofError = String(e).slice(0, 200);
        console.error("[task] proof generation failed:", proofError);
        proof = null; publicSignals = null;
      }
    }
    markSeen(input.proof_tx);
    // Dual-shape response: event-page fields (decision, reason_code, proof_tx)
    // AND starter-prompt fields (proof object + public signals).
    const out = { decision: verdict.decision, reason_code: verdict.reason_code, proof_tx: proofTx };
    if (proof) { out.proof = proof; out.public_signals = publicSignals; }
    else if (!replay) { out.proof = null; out.proof_error = proofError || ("kurier_" + (submitStatus || "not_submitted")); }
    if (submitStatus) out.submission_status = submitStatus;
    return sendJson(res, 200, out);
  });
});

server.listen(PORT, () => console.log(`gatekeeper listening on :${PORT} (hmac=${SECRET ? "on" : "DEV-OFF"}, kurier=${process.env.KURIER_API_KEY ? "on" : "off"})`));
