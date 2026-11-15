// selftest.js — spawns agent.js locally (test HMAC secret, no Kurier key),
// then tests: health shape, preflight, signed valid task, every trap type,
// HMAC failure, proof-replay, and local verification of returned proofs
// (including a tampered-proof negative). Writes test/SELFTEST_LOG.md.
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");

const PORT = 8799;
const SECRET = "selftest-secret-not-a-real-secret";
const SEEN = path.join(__dirname, "test", "seen_selftest.json");
try { fs.unlinkSync(SEEN); } catch (_) {}

const VK = "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
const RECIP = "0x1234567890AbcdEF1234567890aBcdef12345678";
const base = {
  registered_vk: VK, proof_vk: VK, minimum: "1000", public_balance: "1460",
  expiry_block: 8430000, current_block: 8420000,
  recipient: RECIP, condition_recipient: RECIP,
  amount: "500", max_transfer: "1000",
};
let n = 0;
function task(overrides) {
  n += 1;
  return {
    type: "agent-games.proof-gatekeeper.v1",
    task_id: "gk_" + (100 + n) + "_t" + n,
    mode: "competition",
    issued_at: new Date().toISOString(),
    input: { ...base, proof_tx: "0xtestproof" + n, ...overrides },
  };
}
const CASES = [
  { name: "valid condition",    body: task({}),                                    expect: ["APPROVE", "VALID_PROOF"], proof: true },
  { name: "VK substitution",    body: task({ proof_vk: "0x" + "aa".repeat(32) }),   expect: ["REJECT", "VK_SUBSTITUTION"], proof: true },
  { name: "threshold mismatch", body: task({ public_balance: "900" }),             expect: ["REJECT", "THRESHOLD_MISMATCH"], proof: true },
  { name: "recipient mismatch", body: task({ condition_recipient: "0x000000000000000000000000000000000000dEaD" }), expect: ["REJECT", "RECIPIENT_MISMATCH"], proof: true },
  { name: "amount overflow",    body: task({ amount: "1500" }),                    expect: ["REJECT", "AMOUNT_OVERFLOW"], proof: true },
  { name: "expired condition",  body: task({ current_block: 8430001 }),            expect: ["REJECT", "EXPIRED_CONDITION"], proof: true },
  { name: "missing verification (no proof_tx)", body: (() => { const t = task({}); delete t.input.proof_tx; return t; })(), expect: ["REJECT", "MISSING_VERIFICATION"], proof: false },
];

function sign(raw) { return crypto.createHmac("sha256", Buffer.from(SECRET, "utf8")).update(raw).digest("hex"); }
async function post(bodyObj, { signed = true, badSig = false } = {}) {
  const raw = Buffer.from(JSON.stringify(bodyObj), "utf8");
  const headers = { "content-type": "application/json" };
  if (signed) headers["x-agent-games-signature"] = badSig ? sign(Buffer.from("tampered")) : sign(raw);
  const r = await fetch(`http://127.0.0.1:${PORT}/agent`, { method: "POST", headers, body: raw });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, respSig: r.headers.get("x-agent-games-signature"), rawResp: text };
}
const sigValid = (r) => r.respSig ? (sign(Buffer.from(r.rawResp, "utf8")) === r.respSig ? "sig OK" : "SIG MISMATCH") : "no sig";

async function main() {
  const child = spawn("node", [path.join(__dirname, "agent.js")], {
    env: { ...process.env, PORT: String(PORT), AGENT_GAMES_HMAC_SECRET: SECRET, SEEN_FILE: SEEN, KURIER_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write("[agent] " + d));
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => { process.stdout.write("[agent] " + d); if (String(d).includes("listening")) resolve(); });
    setTimeout(() => reject(new Error("server start timeout")), 10000);
  });

  const rows = [];
  const vk = JSON.parse(fs.readFileSync(path.join(__dirname, "verification_key.json"), "utf8"));

  // health — exact shape
  {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    const j = await r.json();
    const exact = r.status === 200 && j.ok === true && j.protocolVersion === "v1" && Object.keys(j).length === 2;
    rows.push({ name: "health exact shape", expect: '{ok:true,protocolVersion:"v1"}', got: JSON.stringify(j), ms: 0, proofCheck: "-", sigOk: "-", pass: exact });
  }
  // preflight — signed request, expect {ok,protocolVersion} + valid response signature
  {
    const pf = { type: "agent-games.preflight.v1", agent_id: "selftest-agent", issued_at: new Date().toISOString(), nonce: "nonce-123" };
    const r = await post(pf);
    const pass = r.status === 200 && r.json && r.json.ok === true && r.json.protocolVersion === "v1" && sigValid(r) === "sig OK";
    rows.push({ name: "preflight", expect: '{ok:true,protocolVersion:"v1"} + valid sig', got: JSON.stringify(r.json), ms: 0, proofCheck: "-", sigOk: sigValid(r), pass });
  }
  // task cases
  let validProof = null;
  for (const c of CASES) {
    const t0 = Date.now();
    const r = await post(c.body);
    const ms = Date.now() - t0;
    let proofCheck = "-";
    if (c.proof) {
      if (r.json && r.json.proof && r.json.public_signals) {
        try { proofCheck = (await snarkjs.groth16.verify(vk, r.json.public_signals, r.json.proof)) ? "verified OK" : "VERIFY FALSE"; }
        catch (e) { proofCheck = "verify error"; }
        if (c.name === "valid condition") validProof = { proof: r.json.proof, public_signals: r.json.public_signals };
      } else proofCheck = "MISSING PROOF";
    }
    const got = r.json ? [r.json.decision, r.json.reason_code] : ["HTTP " + r.status, ""];
    const noKeyShape = !c.proof || (r.json && r.json.proof_tx === null); // no Kurier key locally -> proof_tx must be null, proof present
    const pass = got[0] === c.expect[0] && got[1] === c.expect[1] && (proofCheck === "-" || proofCheck === "verified OK") && noKeyShape;
    rows.push({ name: c.name, expect: c.expect.join("/"), got: got.join("/"), ms, proofCheck, sigOk: sigValid(r), pass });
  }
  // replay: resubmit the valid task (same proof_tx)
  {
    const r = await post(CASES[0].body);
    const got = r.json ? [r.json.decision, r.json.reason_code] : ["HTTP " + r.status, ""];
    rows.push({ name: "proof replay (resubmit valid)", expect: "REJECT/PROOF_REPLAY", got: got.join("/"), ms: 0, proofCheck: "-", sigOk: sigValid(r), pass: got[0] === "REJECT" && got[1] === "PROOF_REPLAY" });
  }
  // HMAC failure: wrong signature -> 401
  {
    const r = await post(CASES[0].body, { badSig: true });
    rows.push({ name: "HMAC failure (bad signature)", expect: "HTTP 401", got: "HTTP " + r.status, ms: 0, proofCheck: "-", sigOk: "-", pass: r.status === 401 });
  }
  // unsigned -> 401
  {
    const r = await post(CASES[0].body, { signed: false });
    rows.push({ name: "unsigned request", expect: "HTTP 401", got: "HTTP " + r.status, ms: 0, proofCheck: "-", sigOk: "-", pass: r.status === 401 });
  }
  // tampered proof: flip one digit of pi_a in the valid proof -> verify must be false
  {
    let res = "no proof captured";
    if (validProof) {
      const tp = JSON.parse(JSON.stringify(validProof.proof));
      tp.pi_a[0] = (BigInt(tp.pi_a[0]) + 1n).toString();
      try { res = (await snarkjs.groth16.verify(vk, validProof.public_signals, tp)) ? "VERIFY TRUE (BAD)" : "verify false (correct)"; }
      catch (_) { res = "verify false (correct)"; }
    }
    rows.push({ name: "tampered proof rejected by verify", expect: "verify false", got: res, ms: 0, proofCheck: res, sigOk: "-", pass: res.startsWith("verify false") });
  }
  child.kill();

  const lines = [
    "# Self-test log — " + new Date().toISOString(),
    "",
    "| # | case | expected | got | time | proof | resp sig | result |",
    "|---|------|----------|-----|------|-------|----------|--------|",
    ...rows.map((r, i) => `| ${i + 1} | ${r.name} | ${r.expect} | ${r.got} | ${r.ms ? r.ms + " ms" : "-"} | ${r.proofCheck} | ${r.sigOk} | ${r.pass ? "PASS" : "FAIL"} |`),
    "",
    `**${rows.filter((r) => r.pass).length}/${rows.length} passed**`,
  ];
  fs.writeFileSync(path.join(__dirname, "test", "SELFTEST_LOG.md"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  process.exit(rows.every((r) => r.pass) ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
