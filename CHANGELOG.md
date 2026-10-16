# Changelog

## 3D migration (branch `voidlight-game`, behind `?r3d=1`)

### Step 5A: Survey lens in 3D (accepted, `70c15ec`)

| Check | Result |
| --- | --- |
| 3D Survey port | **Accepted** |
| `node tests/scenarios.mjs` | **Pass**, 39/39 |
| `THROTTLE=4 node tests/scenarios.mjs` | 38/39. The failure is a known environmental issue (below), not part of Step 5A. |

Scope as accepted:
- **Pure adapter.** `getLensPresentation(sim, obj, lens)` decides everything the 3D layer shows for doorways and entities. It writes nothing and draws no random numbers. Provenance is `visibleNow`, `remembered`, `ledgerEarned` or `unknown`, and unknown is drawn as nothing.
- **Survey follows the 2D rule.**
  - Every doorway within 760 px shows its true state.
  - Within 420 px it also shows when it was last lit.
  - Beyond 760 px only memory shows.
  - The read is the lens's earned knowledge, as `surveyScan` records it.
- **Grid leak fix.** The Survey grid is drawn without depth testing, as 2D draws it, so unlit walls and pillars cannot show through it.
- **Tests.** Survey scenarios A to H, plus capture scenarios for lantern edge, darkness, reduced motion, high contrast and phone.

### Known issue: 2D performance scenario under 4x CPU throttling (separate from Step 5A)

- **Scenario:** `performance: normal frames keep full quality; sustained slow frames halve the darkness mask once`.
- **Where it fails:** only under `THROTTLE=4`, and on the container used from 2026-10-10. It fails the same way on the previous build `fab156a`, which passed 27/27 throttled on the earlier container.
- **Cause:**
  - At 4x this container renders 37 frames in the test's 3 s baseline and 70 in its 8 s stall window.
  - The quality fallback judges only after 120 frames, so it never acts within the wait.
  - Ordinary frames already cost about 30 ms, above the fallback's 12 ms limit.
- **Status:** the assertion is unchanged and has not been weakened. How this scenario should behave under throttling needs its own decision.

### Next

- **Step 5B (Ember and Echo lenses).** Not started. These lenses plug into the same adapter. Survey's behaviour, its 760 px reach and its 2D-parity rule stay as accepted.
- **Open visual items from 5A review, for later steps:**
  - Portrait camera framing on phones.
  - Label overlap on east and west doorways (the same as 2D).
  - The look of the pin-flash brackets.
  - Beacon territory in 3D (Step 6).
