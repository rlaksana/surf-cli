# Research: surf-cli Parallel Execution
Started: 2026-03-17

## Research Questions
| ID | Sub-Question | Track | Priority |
|----|-------------|-------|----------|
| RQ-1 | How does surf-cli handle multiple CLI invocations? | Online | High |
| RQ-2 | Is there a socket locking mechanism? | Offline | High |
| RQ-3 | Can multiple surf commands run simultaneously? | Both | High |
| RQ-4 | What happens when multiple instances try to connect? | Both | Medium |

## Open Questions
- OQ-1: Does the Unix socket support concurrent connections?
- OQ-2: Is there any queue mechanism in the native host?

## Assumption Ledger
| ID | Assumption | Status |
|----|------------|--------|
| A1 | surf-cli uses Unix socket for communication | PENDING |
| A2 | Only one instance can connect at a time | PENDING |
