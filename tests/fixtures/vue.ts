import { createApp, h, type App } from "vue";

/**
 * Mounts a host component whose setup runs `compose`. The fixture owns the
 * render function — these tests assert on values `compose` captures, not on
 * DOM. `prepare` runs against the app before mounting, for installing bindings.
 */
export function mountApp(compose: () => void, prepare?: (app: App) => void) {
  const app = createApp({
    setup() {
      compose();

      return () => h("div");
    },
  });

  prepare?.(app);
  app.mount(document.createElement("div"));

  return { unmount: () => app.unmount() };
}

/**
 * A host with `bindings` installed, composing inside their injected session.
 * `session` is the installed host's session — `install` ran before the mount.
 */
export function mountBindings<TBindings extends { install(app: App): object }>(
  bindings: TBindings,
  compose: (bindings: TBindings) => void,
) {
  const app = createApp({
    setup() {
      compose(bindings);

      return () => h("div");
    },
  });

  // SAFETY: `TBindings` is resolved at each call site, so `install` here returns exactly
  // `ReturnType<TBindings["install"]>`; the constraint widens it to `object` for checking only.
  const session = bindings.install(app) as ReturnType<TBindings["install"]>;
  app.mount(document.createElement("div"));

  return { session, unmount: () => app.unmount() };
}
