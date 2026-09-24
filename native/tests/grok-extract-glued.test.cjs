#!/usr/bin/env node
"use strict";
// Offline check for extractGrokResponse glued-answer handling.
// Run: node native/tests/grok-extract-glued.test.cjs

const path = require("path");
const { execFileSync } = require("child_process");

const { extractGrokResponse } = require("../grok-client.cjs");

const PROMPT = "Reply with the single word PONG and nothing else";
const cases = [
  {
    name: "glued answer + glued chip (new UI, Sep 2026)",
    body: "Pribadi\nApa yang harus kita jelajahi?\nReply with the single word PONG and nothing elsePONGFast\nKeuangan\nMeet Grok Bot\nAI teammates you can give real work to.\nLearn more",
    chips: ["Fast"],
    want: "PONG",
  },
  {
    name: "glued answer, no chip",
    body: "Reply with the single word PONG and nothing elsePONG\nMeet Grok Bot",
    chips: [],
    want: "PONG",
  },
  {
    name: "classic multiline still works",
    body: "Sidebar\nGrok\nReply with the single word PONG and nothing else\nPONG\nFast\nMeet Grok Bot",
    chips: [],
    want: "PONG",
  },
  {
    name: "no question found -> junk either way, banner now stripped to first line",
    body: "Meet Grok Bot\nAI teammates\nLearn more",
    chips: [],
    want: "Meet Grok Bot",
  },
];

let failed = 0;
for (const c of cases) {
  const got = extractGrokResponse(c.body, PROMPT, c.chips);
  const ok = got === c.want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${c.name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(c.want)}`);
}
process.exit(failed ? 1 : 0);
