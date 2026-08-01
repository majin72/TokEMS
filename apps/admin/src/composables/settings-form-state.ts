import { inject, onBeforeUnmount, provide, ref, type InjectionKey, type Ref } from 'vue';

type ResetHandler = (() => void) | null;

export interface SettingsFormScope {
  dirty: Ref<boolean>;
  busy: Ref<boolean>;
  clearDirty: () => void;
  setDirty: (value: boolean) => void;
  setBusy: (value: boolean) => void;
  setResetHandler: (handler: ResetHandler) => void;
  release: () => void;
}

export interface SettingsFormState {
  dirty: Ref<boolean>;
  busy: Ref<boolean>;
  markDirty: () => void;
  discard: () => void;
  activateScope: () => SettingsFormScope;
}

const settingsFormStateKey: InjectionKey<SettingsFormState> = Symbol('settings-form-state');

export function createSettingsFormState(): SettingsFormState {
  const dirty = ref(false);
  const busy = ref(false);
  let activeOwner: symbol | null = null;
  let resetHandler: ResetHandler = null;

  function owns(owner: symbol) {
    return activeOwner === owner;
  }

  return {
    dirty,
    busy,
    markDirty() {
      if (activeOwner) dirty.value = true;
    },
    discard() {
      resetHandler?.();
      dirty.value = false;
    },
    activateScope() {
      const owner = Symbol('settings-form-owner');
      activeOwner = owner;
      resetHandler = null;
      dirty.value = false;
      busy.value = false;

      return {
        dirty,
        busy,
        clearDirty() {
          if (owns(owner)) dirty.value = false;
        },
        setDirty(value) {
          if (owns(owner)) dirty.value = value;
        },
        setBusy(value) {
          if (owns(owner)) busy.value = value;
        },
        setResetHandler(handler) {
          if (owns(owner)) resetHandler = handler;
        },
        release() {
          if (!owns(owner)) return;
          activeOwner = null;
          resetHandler = null;
          dirty.value = false;
          busy.value = false;
        },
      };
    },
  };
}

export function provideSettingsFormState(): SettingsFormState {
  const state = createSettingsFormState();
  provide(settingsFormStateKey, state);
  return state;
}

export function useSettingsFormState(): SettingsFormState {
  const state = inject(settingsFormStateKey);
  if (!state) {
    throw new Error('Settings form state must be used inside ManagementSettingsView');
  }
  return state;
}

export function useSettingsFormScope(): SettingsFormScope {
  const scope = useSettingsFormState().activateScope();
  onBeforeUnmount(scope.release);
  return scope;
}
