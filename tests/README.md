# Pattern Pages test suite

Pattern Pages is a single static HTML file (`index.html`) with no build step - that doesn't
change. This directory is dev/test tooling only: a Playwright suite that drives `index.html`
in a real browser and asserts on real behavior, no mocking.

## Running

```
npm install
npm test              # headless, once
npm run test:headed   # see the browser
npm run test:ui       # Playwright's interactive UI mode
```

Run the full suite before merging any change to `index.html`. It's the same bar this codebase's
cleanup and bugfix work has been held to throughout its history: zero uncaught page errors,
every covered feature still working end to end.

## Layout

- `playwright.config.js` - runs serially (`workers: 1`), on purpose - see the comment there.
- `tests/support/static-server.js` - minimal static file server so tests load `index.html` over
  `http://` instead of `file://` (some browser APIs, like `fetch` and `IndexedDB`, don't behave
  consistently under `file://`).
- `tests/support/fixtures.js` - the shared `test`/`expect` every spec imports. Fails a test if
  any uncaught page error occurred, and exposes `expandAllBoxes`/`clickResilient` helpers for
  interacting with the app's collapsible side-panel boxes (see the comment in that file for why
  a plain click sometimes isn't enough).
- `tests/specs/*.spec.js` - one file per feature area.

## Why some tests look more defensive than a typical app's tests

`index.html` has a long history of being patched by layering a new `<script>` block on top of
an old one rather than editing it in place - so a given feature's *current* behavior often
comes from the last of several superseded generations of the same function, and a handful of
scripts re-render or re-initialize parts of the DOM on their own `setTimeout` schedule well
after page load. Two consequences show up in these tests:

1. **Interactions retry.** `clickResilient()` re-expands collapsed panels and retries a click a
   few times instead of clicking once - a background re-render can otherwise swap out the DOM
   node between "found it" and "clicked it".
2. **Tests exercise the live code path, not internals.** Where practical, a test calls the same
   global function name the UI calls (`addText()`, `setCards()`, `selectLayer()`, ...) rather
   than reaching into a specific `<script>` block - that's what stays correct if a future
   cleanup pass removes a dead generation and leaves a different one as "the" implementation.

If a test in here starts failing after a change to `index.html`, don't disable it - it's
almost certainly telling you a live code path just changed behavior, which is exactly what this
suite exists to catch.

## Touch gesture tests

`tests/specs/gestures.spec.js` dispatches real `TouchEvent`s built with the `Touch` constructor
(`test.use({ hasTouch: true })`), not Playwright/CDP's `Input.dispatchTouchEvent`. CDP's touch
emulation silently drops a `touchend` when it partially releases a multi-touch gesture (one
finger up, one still down) in the same sequence as an immediately preceding partial release -
that's a CDP quirk, not an app bug, and it produced confusing false failures while this suite was
being written. Touch identifiers come from one incrementing counter per test and are never
reused, matching real touch hardware - reusing a small id (0, 1, ...) across two unrelated
gestures in the same test can trip the app's own stale-gesture recovery, which keys off "is this
id still an active touch," not "is this a fresh gesture."
