import test from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS } from '../js/config.js';
import {
    ALL_COMFORT_FILTERS,
    assessNormalizedHour,
    resolveEffectiveLimits
} from '../js/assessment.js';
import { buildCustomLimits, EXPERT_PRESETS } from '../js/expert-profiles.js';
import { createHour } from './helpers.js';

const assess = (overrides = {}, options = {}) => assessNormalizedHour(createHour(overrides), options);

test('Wind: ruhiger Wind bleibt grün', () => {
    const result = assess();
    assert.equal(result.categories.wind, 3);
    assert.equal(result.score, 3);
});

test('Wind: exakte Grenzwerte folgen dem bestehenden strikten Größer-als-Verhalten', () => {
    assert.equal(assess({ surface: { windSpeedKmh: LIMITS.wind.surface.green } }).categories.wind, 3);
    assert.equal(assess({ surface: { windSpeedKmh: LIMITS.wind.surface.yellow } }).categories.wind, 2);
});

test('Wind: starker Bodenwind ist Hard Blocker', () => {
    const result = assess({ surface: { windSpeedKmh: 19 } });
    assert.equal(result.score, 1);
    assert.ok(result.hardBlockers.some(blocker => blocker.code === 'surface-wind'));
});

test('Wind: starke Böen sind Hard Blocker', () => {
    const result = assess({ surface: { gustsKmh: 26 } });
    assert.equal(result.score, 1);
    assert.ok(result.hardBlockers.some(blocker => blocker.code === 'gusts'));
});

test('Wind: große Böendifferenz ist Hard Blocker', () => {
    const result = assess({ surface: { windSpeedKmh: 5, gustsKmh: 21 } });
    assert.equal(result.score, 1);
    assert.ok(result.hardBlockers.some(blocker => blocker.code === 'gust-spread'));
});

test('Wind: starker Höhenwind ist Hard Blocker', () => {
    const hour = createHour();
    hour.wind.levels.find(level => level.pressureHpa === 700).speedKmh = 31;
    const result = assessNormalizedHour(hour);
    assert.equal(result.score, 1);
    assert.ok(result.hardBlockers.some(blocker => blocker.code === 'wind-700'));
});

test('Wind: großer vertikaler Gradient ist Hard Blocker', () => {
    const hour = createHour({ surface: { windSpeedKmh: 5 } });
    hour.wind.levels.find(level => level.pressureHpa === 850).speedKmh = 24;
    const result = assessNormalizedHour(hour);
    assert.equal(result.score, 1);
    assert.ok(result.hardBlockers.some(blocker => blocker.code === 'gradient-1500'));
});

test('Wolken/Sicht: gute Sicht und geringe Bewölkung sind grün', () => {
    assert.equal(assess().categories.clouds, 3);
});

test('Wolken/Sicht: klassische Nebelsituation ist Hard Blocker', () => {
    const result = assess({
        surface: { temperatureC: 10, dewPointC: 9.5, windSpeedKmh: 2, visibilityM: 10000 }
    });
    assert.equal(result.categories.clouds, 1);
    assert.ok(result.hardBlockers.some(blocker => blocker.code === 'severe-fog'));
});

test('Wolken/Sicht: tiefe Bewölkung über 60 Prozent ist rot', () => {
    assert.equal(assess({ clouds: { lowPct: 61 } }).categories.clouds, 1);
});

test('Wolken/Sicht: starke Gesamtbewölkung bleibt v10-gelb', () => {
    assert.equal(assess({ clouds: { totalPct: 76 } }).categories.clouds, 2);
});

test('Niederschlag: trockene Stunde ist grün', () => {
    assert.equal(assess().categories.precip, 3);
});

test('Niederschlag: erhöhte Wahrscheinlichkeit ist gelb', () => {
    assert.equal(assess({ precipitation: { probabilityPct: 31 } }).categories.precip, 2);
});

test('Niederschlag: relevante Menge ist Hard Blocker', () => {
    assert.equal(assess({ precipitation: { amountMm: 1.1 } }).score, 1);
});

test('Niederschlag: relevante Schauer sind Hard Blocker', () => {
    assert.equal(assess({ precipitation: { showersMm: 0.6 } }).score, 1);
});

test('Golden Master: bestehende CAPE- und Instabilitätslogik', () => {
    assert.equal(assess({ convection: { capeJkg: 301 } }).categories.thermik, 2);
    assert.equal(assess({ convection: { capeJkg: 1001 } }).categories.thermik, 1);
    assert.equal(assess({ convection: { liftedIndex: -2.1 } }).categories.thermik, 2);
    assert.equal(assess({ convection: { liftedIndex: -4.1 } }).categories.thermik, 1);
});

test('Expertenmodus: Defaultprofil entspricht LIMITS', () => {
    assert.equal(resolveEffectiveLimits(null, false), LIMITS);
    assert.deepEqual(buildCustomLimits(EXPERT_PRESETS.standard.values).wind.surface, LIMITS.wind.surface);
});

test('Expertenmodus: verändertes Limit gilt identisch für Assessment und Erklärung', () => {
    const custom = buildCustomLimits(EXPERT_PRESETS.pro.values);
    const limits = resolveEffectiveLimits(custom, true);
    const result = assess({ surface: { windSpeedKmh: 20 } }, { limits });

    assert.equal(result.categories.wind, 2);
    assert.equal(result.effectiveLimits.wind.surface.yellow, 22);
    assert.ok(result.reasons.some(reason => reason.text.includes('Bodenwind erhöht')));
    assert.ok(!result.hardBlockers.some(blocker => blocker.code === 'surface-wind'));
});

test('Expertenmodus: Preset-Wechsel verändert die bestehende Bewertung bewusst', () => {
    const beginner = resolveEffectiveLimits(buildCustomLimits(EXPERT_PRESETS.beginner.values), true);
    const pro = resolveEffectiveLimits(buildCustomLimits(EXPERT_PRESETS.pro.values), true);
    const hour = createHour({ surface: { windSpeedKmh: 20 } });

    assert.equal(assessNormalizedHour(hour, { limits: beginner }).score, 1);
    assert.equal(assessNormalizedHour(hour, { limits: pro }).score, 2);
});

test('Hard Blocker bleiben bei deaktivierten Komfortfiltern aktiv', () => {
    const result = assess({
        surface: { windSpeedKmh: 80, visibilityM: 500 },
        convection: { capeJkg: 2000 },
        precipitation: { amountMm: 5 }
    }, {
        comfortFilters: { wind: false, thermik: false, clouds: false, precip: false }
    });
    assert.equal(result.score, 1);
    assert.ok(result.hardBlockers.length >= 4);
});

test('Komfortfilter dürfen nicht-kritische Warnungen weiterhin ausblenden', () => {
    const result = assess({ surface: { windSpeedKmh: 14 } }, {
        comfortFilters: { ...ALL_COMFORT_FILTERS, wind: false }
    });
    assert.equal(result.score, 3);
});

test('Timeline-/Detailquelle: CAPE-Hard-Blocker bleibt bei deaktiviertem Thermikfilter konsistent', () => {
    const result = assess({ convection: { capeJkg: 1500 } }, {
        comfortFilters: { ...ALL_COMFORT_FILTERS, thermik: false }
    });
    assert.equal(result.score, 1);
    assert.equal(result.categories.precip, 1);
    assert.ok(result.hardBlockers.some(blocker => blocker.code === 'cape'));
});

