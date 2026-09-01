import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { isUnavailableDisplayValue, shouldStartPullToRefresh } from '../js/ui.js';

test('Pull-to-Refresh startet ausschließlich am tatsächlichen Seitenanfang', () => {
    assert.equal(shouldStartPullToRefresh(0, false), true);
    assert.equal(shouldStartPullToRefresh(0.5, false), true);
    assert.equal(shouldStartPullToRefresh(2, false), false);
    assert.equal(shouldStartPullToRefresh(1800, false), false);
    assert.equal(shouldStartPullToRefresh(0, true), false);
});

test('Ein Refresh erhält den gewählten Tag und die Tagesauswahl steht zuerst', async () => {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const results = html.slice(html.indexOf('<div id="resultsContainer"'), html.indexOf('<!-- Tagesverlauf-Diagramme'));

    assert.doesNotMatch(main, /function onWeatherLoaded\(\)[\s\S]*?selectDay\(0\)/);
    assert.match(main, /selectDay\(Math\.min\(state\.selectedDay, availableLastDay\)\)/);
    assert.ok(results.indexOf('id="dayComparison"') < results.indexOf('decision-dashboard'));
});

test('Mobile Layout erzeugt keinen zusätzlichen horizontalen Scrollcontainer', async () => {
    const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');

    assert.match(css, /html\s*\{\s*overflow-x:\s*clip/);
    assert.match(css, /html, body\s*\{\s*overflow-x:\s*clip/);
    assert.match(css, /\.main-layout\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
    assert.match(css, /\.main-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    assert.match(css, /#welcomeModal \.welcome-modal\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/s);
});

test('Mobile Standortkarte wird nach der Auswahl kompakt und bleibt wieder öffnbar', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');

    assert.match(html, /id="mobileLocationToggle"[^>]*aria-controls="map"/);
    assert.match(css, /\.map-section\.is-collapsed #map[\s\S]*?display:\s*none/);
    assert.match(main, /updateMobileLocationSummary\(state\.currentLocation\)/);
    assert.match(main, /mobileLocationToggle\.addEventListener\('click', toggleLocationMap\)/);
});

test('Stundenbegründungen sind integriert und nachrangige Bereiche stehen am Ende', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const selectedHourStart = html.indexOf('<section class="selected-hour-card"');
    const selectedHourEnd = html.indexOf('</section>', html.indexOf('</details>', selectedHourStart)) + '</section>'.length;
    const selectedHour = html.slice(selectedHourStart, selectedHourEnd);

    assert.match(selectedHour, /Warum diese Einordnung\?/);
    assert.match(selectedHour, /class="dashboard-details"/);
    assert.ok(html.indexOf('id="liveWindCard"') < html.indexOf('id="windDiagramCard"'));
    assert.ok(html.indexOf('class="secondary-controls"') > html.indexOf('class="params-grid parameter-grid"'));
    assert.doesNotMatch(html, /param-card(?: full-width)? expanded/);
});

test('Nicht verfügbare Anzeigewerte werden als solche erkannt', () => {
    assert.equal(isUnavailableDisplayValue('n. v.'), true);
    assert.equal(isUnavailableDisplayValue('Basis: n. v.'), true);
    assert.equal(isUnavailableDisplayValue('N/A'), true);
    assert.equal(isUnavailableDisplayValue('—'), true);
    assert.equal(isUnavailableDisplayValue('Nutzbare Tiefe: 850 m'), false);
});
