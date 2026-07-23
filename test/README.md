# Test scaffold

The implementation plan defines the executable test order. Add tests without
enabling later units early:

1. `unit/detect.test.ts` and `atdd/detect.atdd.test.ts`
2. parser fixtures plus `unit/parse.test.ts`
3. prompt builder, stage machine, persistence, emit guard, and stage tool
4. `fakes/fake-pi.ts` plus first-turn, advance, and emit-guard ATDD
5. package contract and real Pi smoke

No placeholder tests are marked skipped or todo here. Each unit should begin by
adding an executable failing test and observing the intended red failure.
