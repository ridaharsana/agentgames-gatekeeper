// probe_signals.js — independently probe gatekeeper.wasm for input signal names.
// Circom 2 wasm resolves inputs by FNV-1a-64 hash of the signal name, split into
// MSB/LSB 32-bit halves, passed to the exported getInputSignalSize(hMSB, hLSB).
// A real signal returns size >= 1; a non-signal returns 0 or traps.
// Evidence tool only — not part of the agent server.
const fs = require("fs");

function fnvHash(str) {
  const MOD = BigInt(2) ** BigInt(64);
  let hash = BigInt("0xCBF29CE484222325");
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash *= BigInt(0x100000001B3);
    hash %= MOD;
  }
  return hash.toString(16).padStart(16, "0");
}

async function main() {
  const buf = fs.readFileSync(__dirname + "/circuits/gatekeeper.wasm");
  const imports = {
    runtime: {
      exceptionHandler: (code) => { throw new Error("exception code " + code); },
      printErrorMessage: () => {},
      writeBufferMessage: () => {},
      showSharedRWMemory: () => {},
    },
  };
  const { instance } = await WebAssembly.instantiate(buf, imports);
  const ex = instance.exports;
  ex.init(0);
  console.log("getInputSize() =", ex.getInputSize());
  console.log("getWitnessSize() =", ex.getWitnessSize());
  console.log("version =", ex.getVersion(), ex.getMinorVersion(), ex.getPatchVersion());

  const candidates = [
    // the 13 names reported by two independent public write-ups
    "taskId", "minimum", "publicBalance", "expiryBlock", "currentBlock",
    "recipient", "conditionRecipient", "amount", "maxTransfer",
    "registeredVkHash", "proofVkHash", "salt", "decision",
    // near-miss controls that must NOT exist (snake_case / wrong case / extra)
    "task_id", "public_balance", "max_transfer", "registered_vk",
    "proofTx", "proof_tx", "vkHash", "balance", "decisionHash", "nonce",
  ];
  for (const name of candidates) {
    const h = fnvHash(name);
    const msb = parseInt(h.slice(0, 8), 16);
    const lsb = parseInt(h.slice(8, 16), 16);
    let size, err = null;
    try { size = ex.getInputSignalSize(msb, lsb); } catch (e) { err = String(e).slice(0, 80); }
    console.log(`${name.padEnd(20)} fnv=${h} size=${size === undefined ? "TRAP" : size}${err ? " err=" + err : ""}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
