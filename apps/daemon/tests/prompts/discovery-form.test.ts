import { describe, expect, it } from 'vitest';

import { DISCOVERY_AND_PHILOSOPHY } from '../../src/prompts/discovery.js';

// The default-router exception in `discovery.ts` emits a single `<question-form
// id="task-type">` on turn 1 that combines the routing question (which Open
// Design workflow to take) with the core discovery brief (audience / brand /
// scale / constraints). Before this consolidation, freeform projects (no Home
// chip pick) saw two clarification cards in a row — task-type, then "Quick
// brief — 30 seconds" — which felt like the agent was re-asking. These tests
// lock the single-shot shape so a future prompt edit cannot accidentally split
// the brief into two turns again.

describe('discovery.ts task-type form (single-shot brief)', () => {
  it('emits a task-type form that asks the routing question plus the discovery brief', () => {
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('<question-form id="task-type"');
    // Task-type radio + the four discovery brief fields must all live in this
    // single form so the user does not see a second clarification card.
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('"id": "taskType"');
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('"id": "audience"');
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('"id": "brand"');
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('"id": "scale"');
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('"id": "constraints"');
  });

  it('preserves the three branch values RULE 2 dispatches on', () => {
    // RULE 2 line 130+ keys off these exact `brand` answer values to choose
    // Branch A (real brand source) vs Branch B (auto-pick). They are part of
    // the discovery contract — labels can localize but values must not.
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('"value": "pick_direction"');
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('"value": "brand_spec"');
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('"value": "reference_match"');
  });

  it('keeps the eight canonical task-type options', () => {
    const options = [
      'Prototype',
      'Live artifact',
      'Slide deck',
      'Image',
      'Video',
      'HyperFrames',
      'Audio',
      'Other',
    ];
    for (const option of options) {
      expect(DISCOVERY_AND_PHILOSOPHY).toContain(`"${option}"`);
    }
  });

  it('forbids the agent from emitting a second Quick brief form after task-type answers', () => {
    // The whole point of the consolidation: once turn 1's task-type form is
    // answered, turn 2 must go straight to brand handling / planning.
    expect(DISCOVERY_AND_PHILOSOPHY).toMatch(
      /do NOT emit any second `<question-form>` for that turn/,
    );
  });

  it('forbids tailored "X brief" variants that re-ask the discovery questions', () => {
    // The first revision of the consolidation only banned id="discovery" /
    // "Quick brief — 30 seconds" by literal token, so the agent worked around
    // it with names like `id="migration-brief"` / "Migration prototype brief".
    // The prompt now enumerates the workaround surface so a single literal
    // ban isn't the only line of defence.
    expect(DISCOVERY_AND_PHILOSOPHY).toMatch(/Any `id="\*-brief"` form/);
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('"X prototype brief"');
    expect(DISCOVERY_AND_PHILOSOPHY).toContain('Migration brief');
  });

  it('allows one inline plain-prose follow-up but forbids batched question cards', () => {
    // Escape hatch so the agent can still ask one genuinely-uninferrable
    // critical question (e.g. a repo URL the user forgot to include) without
    // resurrecting the two-card flow. The ban targets card-shaped follow-ups
    // specifically, not all clarification.
    expect(DISCOVERY_AND_PHILOSOPHY).toMatch(/ask \*\*one\*\* concise inline follow-up in plain prose/);
    expect(DISCOVERY_AND_PHILOSOPHY).toMatch(/NOT a `<question-form>` card/);
    expect(DISCOVERY_AND_PHILOSOPHY).toMatch(/never batch multiple questions/);
  });

  it('teaches RULE 2 to accept the task-type answer marker alongside discovery', () => {
    // RULE 2's first sentence enumerates the answer markers it routes on. The
    // single-shot brief means `[form answers — task-type]` must be a valid
    // entry point — equivalent to `[form answers — discovery]` for the brand
    // branching logic that follows.
    expect(DISCOVERY_AND_PHILOSOPHY).toMatch(
      /\[form answers — discovery\][^.]*\[form answers — task-type\]/,
    );
  });
});
