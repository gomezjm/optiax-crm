/**
 * Nav-guard decision (WS-D4 §0.2/§4). The full provider wires this to a confirm
 * dialog and the sidebar; the load-bearing rule — an unsaved (dirty) screen
 * intercepts in-app navigation while a clean one lets it through — is this pure
 * predicate. Unit-tested here since the dashboard has no DOM test harness.
 */
import { describe, expect, it } from 'vitest';
import { shouldConfirmNavigation } from '../../src/components/shell/nav-guard';

describe('shouldConfirmNavigation', () => {
  it('does not confirm when nothing is registered', () => {
    expect(shouldConfirmNavigation(new Set())).toBe(false);
  });

  it('does not confirm when the only guard is clean', () => {
    expect(shouldConfirmNavigation(new Set([() => false]))).toBe(false);
  });

  it('confirms when a guard is dirty (unsaved /agent edits)', () => {
    expect(shouldConfirmNavigation(new Set([() => true]))).toBe(true);
  });

  it('confirms when any of several guards is dirty', () => {
    expect(shouldConfirmNavigation(new Set([() => false, () => true, () => false]))).toBe(true);
  });

  it('reflects the live predicate value, not a snapshot', () => {
    let dirty = false;
    const guards = new Set([() => dirty]);
    expect(shouldConfirmNavigation(guards)).toBe(false);
    dirty = true; // e.g. the user typed into the configurator
    expect(shouldConfirmNavigation(guards)).toBe(true);
  });
});
