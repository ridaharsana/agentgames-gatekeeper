// lib/proof.js — local Groth16 proof generation with the official circuit.
// Signal names/order are proven against the wasm (see CIRCUIT.md).
"use strict";
const path = require("path");
const crypto = require("crypto");
const snarkjs = require("snarkjs");
const { taskIdOf, toBig } = require("./decision");

const WASM = path.join(__dirname, "..", "circuits", "gatekeeper.wasm");
const ZKEY = path.join(__dirname, "..", "circuits", "gatekeeper_final.zkey");

async function prove(task, input, verdict) {
  const circuitInput = {
    taskId: taskIdOf(task.task_id),
    minimum: String(toBig(input.minimum)),
    publicBalance: String(toBig(input.public_balance)),
    expiryBlock: String(toBig(input.expiry_block)),
    currentBlock: String(toBig(input.current_block)),
    recipient: String(toBig(input.recipient)),
    conditionRecipient: String(toBig(input.condition_recipient)),
    amount: String(toBig(input.amount)),
    maxTransfer: String(toBig(input.max_transfer)),
    registeredVkHash: String(toBig(input.registered_vk)),
    proofVkHash: String(toBig(input.proof_vk)),
    salt: BigInt("0x" + crypto.randomBytes(16).toString("hex")).toString(), // private, fresh per task
    decision: verdict.decision === "APPROVE" ? "1" : "0",
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInput, WASM, ZKEY);
  return { proof, publicSignals };
}

module.exports = { prove };
