// lib/hmac.js — HMAC-SHA256 signing/verification for Agent Games envelopes.
// Header: x-agent-games-signature, computed over the RAW body bytes.
// Requests are verified before parsing; every response is signed the same way.
// Secret comes only from env AGENT_GAMES_HMAC_SECRET (never hardcoded/logged).
"use strict";
const crypto = require("crypto");

const SIG_HEADER = "x-agent-games-signature";

function loadSecret() {
  const s = process.env.AGENT_GAMES_HMAC_SECRET || process.env.AGENT_GAMES_SECRET; // 2nd = legacy fallback
  if (!s) return null;
  const hex = process.env.AGENT_GAMES_HMAC_SECRET_HEX === "1" || process.env.AGENT_GAMES_SECRET_HEX === "1";
  return hex ? Buffer.from(s, "hex") : Buffer.from(s, "utf8");
}

function sign(secret, rawBody) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

function verify(secret, rawBody, headerValue) {
  const got = (headerValue || "").toString().replace(/^sha256=/, "").trim().toLowerCase();
  if (!got) return false;
  const want = sign(secret, rawBody);
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { SIG_HEADER, loadSecret, sign, verify };
