import { mount, unmount } from "svelte";
import { ZeroProvider } from "../../src/adapters/svelte/index.ts";

/** A minimal observable cell for plain-JS tests: reads track, writes notify. */
interface ObservableCell<T> {
  get current(): T;
  set current(value: T);
}

/** Creates an {@link ObservableCell} holding `initial`. */
export function state<T>(initial: T): ObservableCell<T> {
  // Backed by the adapter's own reactivity: the fixture is compiled by the
  // Svelte plugin, so `$state` here is the same primitive a consumer's
  // `.svelte.ts` module would use.
  let value = $state(initial);

  return {
    get current() {
      return value;
    },
    set current(next: T) {
      value = next;
    },
  };
}

/** A mounted host, its composed value, and its teardown. */
interface Mounted<TValue> {
  /** What `compose` returned during setup; assigned before `mount` returns. */
  readonly value: TValue;
  readonly unmount: () => void;
}

/**
 * Mounts `bindings`' `ZeroProvider` and composes inside a child component —
 * the exact position the hooks require (below the provider, during init).
 * `mount` treats any function as a component, so the probe needs no template;
 * the session reaches the test through `bindings.useSession()` inside
 * `compose`.
 */
export function mountBindings<TBindings extends { provide(): { dispose(): void } }, TValue>(
  bindings: TBindings,
  compose: (bindings: TBindings) => TValue,
): Mounted<TValue> {
  let value!: TValue;

  function Probe() {
    value = compose(bindings);

    return {};
  }

  let teardownProbe: (() => void) | undefined;

  const component = mount(ZeroProvider, {
    target: document.createElement("div"),
    props: {
      bindings,
      children: (anchor: HTMLElement) => {
        // Snippet mount: the probe attaches at the snippet's anchor, which is
        // only `anchor`, not `target` — the runtime supports it, the
        // `MountOptions` type insists on `target`. A component mounted this
        // way is not destroyed with the tree, so `unmount` tears it down
        // first — resources dispose while the session is still alive.
        // SAFETY: at runtime `mount` accepts this anchor-only options object;
        // `MountOptions` only insists on a `target` the snippet mount has not.
        const probe = mount(Probe, { anchor, props: {} } as never);

        teardownProbe = () => void unmount(probe);
      },
    },
  });

  return {
    value,
    unmount: () => {
      teardownProbe?.();
      void unmount(component);
    },
  };
}
