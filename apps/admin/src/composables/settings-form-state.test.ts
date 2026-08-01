import { describe, expect, it, vi } from 'vitest';
import { createSettingsFormState } from './settings-form-state';

describe('settings form state', () => {
  it('keeps stale form scopes from changing the active form state', () => {
    const state = createSettingsFormState();
    const firstReset = vi.fn();
    const secondReset = vi.fn();
    const first = state.activateScope();

    first.setResetHandler(firstReset);
    first.setDirty(true);
    first.setBusy(true);

    const second = state.activateScope();
    second.setResetHandler(secondReset);
    second.setDirty(true);
    first.clearDirty();
    first.setBusy(true);
    first.setResetHandler(firstReset);

    expect(state.dirty.value).toBe(true);
    expect(state.busy.value).toBe(false);

    state.discard();

    expect(firstReset).not.toHaveBeenCalled();
    expect(secondReset).toHaveBeenCalledOnce();
    expect(state.dirty.value).toBe(false);
  });

  it('clears dirty and busy state when the active scope is released', () => {
    const state = createSettingsFormState();
    const scope = state.activateScope();

    scope.setDirty(true);
    scope.setBusy(true);
    scope.release();

    expect(state.dirty.value).toBe(false);
    expect(state.busy.value).toBe(false);
  });
});
