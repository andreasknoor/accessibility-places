// Types for the vitest-axe matcher registered in vitest.setup.ts (Phase 0).
// vitest-axe ships its augmentation against the legacy `Vi` namespace, which
// vitest 4 no longer reads, so declare the matcher on vitest's own Assertion
// type directly. Runtime registration happens in vitest.setup.ts.
import type { AxeResults } from "axe-core"

interface AxeMatchers<R = unknown> {
  toHaveNoViolations(): R
}

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

// Keep AxeResults referenced so the import is not elided.
export type { AxeResults }
