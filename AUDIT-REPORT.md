# SkyCheck Code-Audit Report

**Datum:** 2026-02-08
**Version:** v10.0
**Auditor:** Claude Code (Opus 4.6)

---

## Zusammenfassung

| Schwere | Anzahl | Bereiche |
|---------|--------|----------|
| **KRITISCH** | 3 | Accessibility (fehlende Focus-Styles, Theme-Toggle nicht keyboard-zugänglich) |
| **HOCH** | 14 | Security (CSP deaktiviert, API-Response unvalidiert), Redundanz (duplizierte Scoring-Logik), CSS-Konflikte, PWA-Icons fehlen |
| **MITTEL** | 34 | Redundanzen, fehlende Error-Handling, Inkonsistenzen, Performance |
| **NIEDRIG** | 34 | Dead Code, Minor Cleanups |

---

## 1. KRITISCH - Sofort beheben

### K1: Keine Focus-Styles (WCAG-Verstoß)
- **Datei:** css/styles.css
- **Problem:** Im gesamten Stylesheet existieren keine `:focus-visible`-Styles. Die einzigen `:focus`-Regeln entfernen den Outline (`outline: none` auf Input-Feldern). Keyboard-Nutzer können nicht erkennen, welches Element fokussiert ist.
- **Fix:** Global-Regel `*:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` hinzufuegen.
- **Status:** BEHOBEN

### K2: Theme-Toggle nicht accessible
- **Datei:** index.html:60
- **Problem:** `<div class="theme-switch" id="themeToggle">` ist ein `<div>` ohne `role`, `tabindex` oder `aria-*` Attribute. Nicht per Tastatur bedienbar.
- **Fix:** `role="switch"`, `tabindex="0"`, `aria-checked="false"`, `aria-label="Dunkles Design umschalten"` hinzufuegen.
- **Status:** BEHOBEN

### K3: `prefers-reduced-motion` fehlt
- **Datei:** css/styles.css
- **Problem:** 8+ Animationen ohne Opt-out fuer bewegungsempfindliche Nutzer.
- **Fix:** Media-Query ergaenzen.
- **Status:** BEHOBEN

---

## 2. HOCH - Zeitnah beheben

### Sicherheit

| # | Datei:Zeile | Problem | Status |
|---|-------------|---------|--------|
| H1 | index.html:7-9 | **CSP auskommentiert** - kein XSS-Schutz | BEHOBEN |
| H2 | weather.js:155,196 | **API-Response nicht strukturell validiert** - crasht bei malformed Response | BEHOBEN |
| H3 | weather.js:26-36 | **Prototype Pollution in `deepMerge()`** - `for...in` ohne `hasOwnProperty` | BEHOBEN |
| H4 | ui.js:901-923 | **innerHTML ohne escapeHtml()** in `renderRiskExplanation()` | BEHOBEN |

### Redundanz

| # | Dateien | Problem | Status |
|---|---------|---------|--------|
| H5 | favorites.js vs weather.js | **Komplette Scoring-Logik dupliziert** | BEHOBEN |

### CSS-Konflikte

| # | Zeilen | Problem | Status |
|---|--------|---------|--------|
| H6 | CSS 386-408 vs 498-502 | **Duplicate `.traffic-light` Selektor** | BEHOBEN |
| H7 | CSS 215 vs 1037-1040 | **`@keyframes pulse` doppelt definiert** | BEHOBEN |

### PWA

| # | Problem | Status |
|---|---------|--------|
| H8 | manifest.json referenziert `logo-192.png` und `logo-512.png` die nicht existieren | BEHOBEN |

---

## 3. MITTEL - Geplant beheben

### Sicherheit & Error Handling

| # | Datei:Zeile | Problem | Status |
|---|-------------|---------|--------|
| M1 | sw.js:98-174 | **Kein Cache-TTL** - Offline beliebig alte Wetterdaten | BEHOBEN |
| M2 | map.js:115-123 | **Elevation-API ohne Timeout** | BEHOBEN |
| M3 | weather.js:305-311 | **`refreshData()` null-check fehlt** | BEHOBEN |
| M4 | utils.js:184 | **`validateCustomLimits()` Guard fehlerhaft** | BEHOBEN |

### Inkonsistenzen

| # | Problem | Status |
|---|---------|--------|
| M5 | `getWindArrowColor()` hardcoded Limits statt Expert-Mode | BEHOBEN |
| M6 | `--bg-secondary` nie definiert, 6 Stellen betroffen | BEHOBEN |
| M7 | Inkonsistente Breakpoints ohne System | OFFEN |
| M8 | Google Fonts ohne SRI, Mixed Content in Attribution | BEHOBEN |
| M9 | OG-Tags unvollstaendig, kein Twitter Card, kein Canonical | BEHOBEN |
| M10 | Apple Touch Icon ist SVG (iOS braucht PNG) | BEHOBEN |

### Redundanzen

| # | Problem | Status |
|---|---------|--------|
| M11 | Haversine-Berechnung dupliziert (weather.js vs utils.js) | BEHOBEN |
| M12 | `degToCompass()` dupliziert (weather.js vs utils.js) | BEHOBEN |
| M13 | `formatMeasurementAge()` dupliziert (weather.js vs ui.js) | BEHOBEN |
| M14 | 8 separate `@media (max-width: 600px)` Bloecke | OFFEN |

---

## 4. NIEDRIG - Bei Gelegenheit

| # | Problem | Status |
|---|---------|--------|
| L1 | Dead Code: `toggleWindDiagram()`, `loadWindDiagramState()` No-ops | BEHOBEN |
| L2 | Dead Code: `updateWarnings()` leere Funktion | BEHOBEN |
| L3 | `hideLiveWindButton()` exportiert aber nie importiert | BEHOBEN |
| L4 | `--status-*` CSS-Variablen definiert aber nie verwendet | BEHOBEN |
| L5 | `handleError()` Option `showToast` zeigt keinen Toast | OFFEN |
| L6 | `window.APP_VERSION` global exponiert | OFFEN |
| L7 | Keine maximale Favoriten-Anzahl | BEHOBEN |
| L8 | DOM-Cache nie invalidiert | OFFEN |
| L9 | 15+ Inline-Styles verhindern strikte CSP | BEHOBEN |
| L10 | manifest.json `"purpose": "any maskable"` deprecated | BEHOBEN |

---

## 5. Verbesserungsvorschlaege

### Architektur
1. **Leaflet lokal bundlen** statt CDN-Abhaengigkeit
2. **Service Worker: Cache-TTL fuer Wetterdaten** (max 6h offline)
3. **Shared Scoring Pipeline** - `getHourScore()` zentral fuer Hauptansicht + Favoriten
4. **CSP aktivieren** + Inline-Code externalisieren

### Code-Qualitaet
5. **CSS-Variablen-System vervollstaendigen** (`--bg-secondary`, `--spacing-*`, Breakpoints)
6. **Dead Code entfernen** (~5 ungenutzte Funktionen/Exports)
7. **Utility-Funktionen konsolidieren** (Haversine, degToCompass, formatAge)
8. **Media Queries konsolidieren** (nach Breakpoint gruppieren)

### Accessibility
9. **Focus-Styles** hinzufuegen
10. **ARIA-Pattern fuer Tabs** im About-Modal
11. **Reduzierte Bewegung** respektieren
12. **Contrast-Ratio pruefen** (Gruener Toast #4CAF50 mit weissem Text nur 3.2:1)
