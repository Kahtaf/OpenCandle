# Resume Delegated Run

- Interruption reason (timeout / crash / capacity): `<fill in>`
- The working tree preserved prior progress.
- Continue from where the run stopped without redoing completed work.
- If the prior attempt failed, resume with the failure loop: diagnose the cause, reproduce it as a
  credible regression red, fix the actual cause at the narrowest durable layer, and verify with a
  focused run. Classify product defect vs inaccurate assertion vs harness/environment first; never
  weaken or delete a required check, retry until green, overfit prompts, or suppress failed evidence.
- Preserve all failed evidence and attempts. Genuinely unavailable credentials/external dependencies
  or scope contradictions go to the parent with a concrete diagnosis and preserved progress; do not
  substitute mocks or invent proof.
- By default, re-run `npm run gates` before handoff. Only when the parent explicitly centralizes the
  full/live gate, run the assigned focused proof instead and disclose the required pending gate work
  honestly.
- Produce the same final report: files changed, proof outputs, and deviations.
