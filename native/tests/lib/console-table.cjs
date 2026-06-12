"use strict";

/**
 * Render an array of result objects as a monospace-aligned table.
 *
 *   { provider, status, tookMs, responseLength, failureKind }
 *
 * Output example:
 *   Provider     Status    Time     Chars  FailureKind
 *   chatgpt      PASS      12.4s    4      -
 *   gemini       FAIL      90.0s    0      complete-timeout
 */
function render(results) {
  const rows = results.map((r) => ({
    Provider: r.provider,
    Status: r.status,
    Time: `${(r.tookMs / 1000).toFixed(1)}s`,
    Chars: String(r.responseLength),
    FailureKind: r.failureKind || "-",
  }));

  const headers = ["Provider", "Status", "Time", "Chars", "FailureKind"];
  const widths = headers.map((h) => {
    const colValues = rows.map((r) => r[h]);
    return Math.max(h.length, ...colValues.map((v) => String(v).length));
  });

  const pad = (s, w) => String(s).padEnd(w);
  const sep = (w) => "-".repeat(w);

  const lines = [];
  lines.push(headers.map((h, i) => pad(h, widths[i])).join("  "));
  lines.push(widths.map(sep).join("  "));
  for (const row of rows) {
    lines.push(headers.map((h, i) => pad(row[h], widths[i])).join("  "));
  }

  // Summary line
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.length - pass;
  const summary =
    fail === 0
      ? `\n${pass}/${results.length} providers PASS.`
      : `\n${pass}/${results.length} providers PASS. ${fail} FAIL.`;

  return lines.join("\n") + summary;
}

module.exports = { render };
