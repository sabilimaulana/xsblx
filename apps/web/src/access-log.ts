import { definePlugin } from "nitro";

// One line per request from the Nitro server that serves the SSR routes and
// `/assets/*`. This runs outside the Effect runtime — the frontend server has no
// Effect logger to go through, so `console` is the transport here (the ban on it
// applies to Effect code, where it would bypass the configured logger).
const started = new WeakMap<object, number>();

export default definePlugin((nitro) => {
  nitro.hooks.hook("request", (event) => {
    started.set(event, performance.now());
  });

  nitro.hooks.hook("response", (res, event) => {
    const start = started.get(event);
    started.delete(event);
    const url = new URL(event.req.url);
    // Static files are noise here: one page view drags in every asset. A dot in
    // the last path segment is the whole test — `/assets/*.js`, `/favicon.ico`
    // and dev's `/@vite/*.mjs` all have one, routes do not.
    if (url.pathname.slice(url.pathname.lastIndexOf("/")).includes(".")) return;
    const ms = start === undefined ? "-" : `${(performance.now() - start).toFixed(1)}ms`;
    console.info(`${event.req.method} ${url.pathname}${url.search} ${res.status} ${ms}`);
  });
});
