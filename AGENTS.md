# Repository Guidelines

## Project Structure & Module Organization

SkyCheck is a dependency-free static Progressive Web App. `index.html` defines the UI shell, `css/styles.css` contains all application styling, and `js/main.js` coordinates startup and event handling. Keep domain logic in the existing focused ES modules: `weather.js` for API requests and weather evaluation, `map.js` for Leaflet and location behavior, `favorites.js` for saved locations, `ui.js` for rendering, `state.js` for shared state, `config.js` for constants and thresholds, and `utils.js` for reusable helpers. PWA metadata and caching live in `manifest.json` and `sw.js`; logos and icons belong in `img/`. `AUDIT-REPORT.md` records known technical and accessibility findings.

## Build, Test, and Development Commands

There is no build step or package manager. Serve the repository over HTTP so ES modules, geolocation, and the service worker behave correctly:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Use `git diff --check` before committing to catch whitespace errors. Browser developer tools are the primary debugging environment; inspect the Console, Network, Application, and Cache Storage panels.

## Coding Style & Naming Conventions

Use four-space indentation in JavaScript and CSS, semicolons in JavaScript, single-quoted strings, and trailing commas only where already established. Follow existing naming: `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for constants, and descriptive lowercase filenames. Keep UI text and explanatory comments in German to match the application. Prefer small named functions, ES module imports/exports, guarded DOM access, and centralized values in `config.js`. Avoid new inline styles or unsafe `innerHTML`; preserve CSP and accessibility attributes.

## Testing Guidelines

No automated test framework or coverage target is configured. Manually smoke-test desktop and mobile layouts, keyboard navigation, light/dark and contrast modes, location selection, favorites, weather refresh, offline reload, and malformed or unavailable API responses. When changing cached assets, increment the cache version constants in `sw.js`, then unregister the old service worker or clear site data during verification.

## Commit & Pull Request Guidelines

Recent commits use short German subjects with a category prefix, for example `Fix: Ampel-Begründung fehlt ...`, `Feature: Welcome-Modal ...`, or `Refactor: CSS Media Queries ...`. Keep each commit focused and use the same imperative, category-first format. Pull requests should explain user-visible behavior, list manual checks, link relevant issues or audit items, and include before/after screenshots for layout changes. Call out changes to safety thresholds, external APIs, CSP, or service-worker caching explicitly.
