import test from 'node:test';
import assert from 'node:assert/strict';

import { assessNormalizedHour, resolveEffectiveLimits } from '../js/assessment.js';
import { buildCustomLimits, EXPERT_PRESETS } from '../js/expert-profiles.js';
import { HARD_SAFETY_THRESHOLDS } from '../js/safety-config.js';
import { assessSafety } from '../js/safety-engine.js';
import { validateCustomLimits } from '../js/utils.js';
import { circularDirectionDifference } from '../js/weather-metrics.js';
import { createHour } from './helpers.js';

function setLevel(hour, pressureHpa, values) {
    Object.assign(hour.wind.levels.find(level => level.pressureHpa === pressureHpa), values);
    return hour;
}

test('Safety A: ruhiger vollständiger Tag ist relaxed', () => {
    const result = assessSafety(createHour());
    assert.equal(result.level, 'relaxed');
    assert.equal(result.blockers.length, 0);
    assert.equal(result.limitingFactor, null);
    assert.equal(result.dataQuality.criticalMissing.length, 0);
});

test('Safety B: mäßiger Höhenwind wird sporty', () => {
    const hour = setLevel(createHour(), 700, { speedKmh: 28 });
    const result = assessSafety(hour);
    assert.equal(result.level, 'sporty');
    assert.ok(result.reasons.some(reason => reason.code === 'wind-700'));
    assert.equal(result.metrics.strongestAloftWindKmh, 28);
});

test('Safety C: deutlich stärkerer Höhenwind wird demanding', () => {
    const hour = createHour({ surface: { windSpeedKmh: 12, gustsKmh: 14 } });
    setLevel(hour, 900, { speedKmh: 20 });
    setLevel(hour, 850, { speedKmh: 25 });
    setLevel(hour, 800, { speedKmh: 29 });
    setLevel(hour, 700, { speedKmh: 35 });
    const result = assessSafety(hour);
    assert.equal(result.level, 'demanding');
    assert.equal(result.blockers.length, 0);
    assert.equal(result.limitingFactor.code, 'wind-700');
});

test('Safety D: Extremwind ist profilunabhängig critical', () => {
    const hour = createHour({ surface: { windSpeedKmh: HARD_SAFETY_THRESHOLDS.wind.surfaceKmh + 1 } });
    const profiles = ['beginner', 'standard', 'pro'].map(name =>
        resolveEffectiveLimits(buildCustomLimits(EXPERT_PRESETS[name].values), true)
    );

    for (const limits of profiles) {
        const result = assessSafety(hour, { limits });
        assert.equal(result.level, 'critical');
        assert.ok(result.blockers.some(blocker => blocker.code === 'surface-wind'));
        assert.equal(result.hardSafetyThresholds.wind.surfaceKmh, HARD_SAFETY_THRESHOLDS.wind.surfaceKmh);
    }

    const overlyPermissive = buildCustomLimits(EXPERT_PRESETS.pro.values);
    overlyPermissive.wind.surface = { green: 40, yellow: 50 };
    assert.equal(assessSafety(hour, { limits: overlyPermissive }).level, 'critical');
});

test('Safety E: starke benachbarte Geschwindigkeitsscherung wird demanding', () => {
    const hour = createHour({ surface: { windSpeedKmh: 5, gustsKmh: 8 } });
    setLevel(hour, 900, { speedKmh: 7 });
    setLevel(hour, 850, { speedKmh: 9 });
    setLevel(hour, 800, { speedKmh: 29 });
    setLevel(hour, 700, { speedKmh: 29 });
    const result = assessSafety(hour);
    assert.equal(result.metrics.maxAdjacentSpeedShearKmh, 20);
    assert.equal(result.level, 'demanding');
    assert.ok(result.reasons.some(reason => reason.code === 'speed-shear-adjacent'));
});

test('Extreme benachbarte Scherung wird erst zusammen mit starkem Höhenwind critical', () => {
    const hour = createHour({ surface: { windSpeedKmh: 5, gustsKmh: 8 } });
    setLevel(hour, 900, { speedKmh: 7 });
    setLevel(hour, 850, { speedKmh: 30 });
    setLevel(hour, 800, { speedKmh: 31 });
    setLevel(hour, 700, { speedKmh: 32 });
    const result = assessSafety(hour);
    assert.equal(result.level, 'critical');
    assert.ok(result.blockers.some(blocker => blocker.code === 'speed-shear-with-strong-wind'));
});

test('Safety F: Richtungsscherung beeinflusst den Status sichtbar', () => {
    const hour = createHour({ surface: { windDirectionDeg: 180 } });
    setLevel(hour, 900, { directionDeg: 180 });
    setLevel(hour, 850, { directionDeg: 180 });
    setLevel(hour, 800, { directionDeg: 220 });
    setLevel(hour, 700, { directionDeg: 270 });
    const result = assessSafety(hour);
    assert.equal(result.metrics.maxAdjacentDirectionShearDeg, 50);
    assert.equal(result.metrics.maxOverallDirectionShearDeg, 90);
    assert.equal(result.level, 'demanding');
    assert.ok(result.reasons.some(reason => reason.code === 'direction-shear'));
});

test('Safety G: Richtungsdifferenz behandelt 0°/360° korrekt', () => {
    assert.equal(circularDirectionDifference(350, 10), 20);
    assert.equal(circularDirectionDifference(10, 350), 20);
});

test('Safety H: schlechte Sicht und tiefe Bewölkung verschlechtern Safety', () => {
    const demanding = assessSafety(createHour({
        surface: { visibilityM: 3000 },
        clouds: { lowPct: 50 }
    }));
    const critical = assessSafety(createHour({ surface: { visibilityM: 1200 } }));
    assert.equal(demanding.level, 'demanding');
    assert.equal(critical.level, 'critical');
    assert.ok(critical.blockers.some(blocker => blocker.code === 'severe-visibility'));
});

test('80 Prozent tiefe Bewölkung bei guter Sicht und ruhigem Wind ist nicht critical', () => {
    const result = assessSafety(createHour({
        surface: { visibilityM: 20000, windSpeedKmh: 5, gustsKmh: 8 },
        clouds: { lowPct: 80 }
    }));
    assert.equal(result.level, 'demanding');
    assert.equal(result.blockers.length, 0);
    assert.ok(result.reasons.some(reason => reason.code === 'low-clouds' && !reason.hardBlocker));
});

test('Große Boden-3000-m-Differenz bei moderaten Nachbarschritten ist kein Hard Blocker', () => {
    const hour = createHour({ surface: { windSpeedKmh: 5, gustsKmh: 8 } });
    setLevel(hour, 900, { speedKmh: 12 });
    setLevel(hour, 850, { speedKmh: 19 });
    setLevel(hour, 800, { speedKmh: 26 });
    setLevel(hour, 700, { speedKmh: 34 });
    const result = assessSafety(hour);
    assert.equal(result.metrics.gradient3000, 29);
    assert.equal(result.metrics.maxAdjacentSpeedShearKmh, 8);
    assert.equal(result.level, 'demanding');
    assert.equal(result.blockers.length, 0);
    assert.ok(result.reasons.some(reason => reason.code === 'speed-shear-total' && !reason.hardBlocker));
});

test('Einheitlicher extremer Höhenwind nutzt eine vorläufige profilunabhängige Grenze', () => {
    const hour = createHour();
    for (const pressure of [900, 850, 800, 700]) {
        setLevel(hour, pressure, { speedKmh: HARD_SAFETY_THRESHOLDS.wind.aloftExtremeKmh + 1 });
    }
    const result = assessSafety(hour);
    assert.equal(result.level, 'critical');
    assert.ok(result.blockers.some(blocker => blocker.code === 'aloft-extreme-wind'));
});

test('Safety I: starke Gesamtbewölkung allein ist kein Safety-Faktor', () => {
    const result = assessSafety(createHour({ clouds: { totalPct: 100, lowPct: 10 } }));
    assert.equal(result.level, 'relaxed');
    assert.ok(!result.reasons.some(reason => reason.code === 'total-clouds'));
});

test('Safety J: CAPE allein erzeugt nur einen Aufmerksamkeitshinweis', () => {
    const result = assessSafety(createHour({
        convection: { capeJkg: 1600, liftedIndex: 0 },
        precipitation: { amountMm: 0, probabilityPct: 0, showersMm: 0 },
        weatherCode: 0
    }));
    assert.equal(result.level, 'relaxed');
    assert.equal(result.blockers.length, 0);
    assert.ok(result.reasons.some(reason => reason.code === 'cape-attention' && reason.level === null));
});

test('Safety K: kombinierte CAPE-, LI- und Schauersignale sind critical', () => {
    const result = assessSafety(createHour({
        convection: { capeJkg: 1600, liftedIndex: -5 },
        precipitation: { amountMm: 0, probabilityPct: 50, showersMm: 0.2 },
        weatherCode: 80
    }));
    assert.equal(result.level, 'critical');
    assert.ok(result.blockers.some(blocker => blocker.code === 'combined-convection'));
});

test('Hohe CAPE und negativer LI mit geringem unspezifischem Niederschlag sind nicht critical', () => {
    const result = assessSafety(createHour({
        convection: { capeJkg: 1600, liftedIndex: -5 },
        precipitation: { amountMm: 0.2, probabilityPct: 50, showersMm: 0 },
        weatherCode: 61
    }));
    assert.equal(result.level, 'demanding');
    assert.equal(result.blockers.length, 0);
    assert.ok(result.reasons.some(reason => reason.code === 'convection-signals'));
});

test('Expliziter Gewitter-Wettercode ist unabhängig von CAPE und LI critical', () => {
    const result = assessSafety(createHour({
        convection: { capeJkg: null, liftedIndex: null },
        precipitation: { amountMm: 0, probabilityPct: 0, showersMm: 0 },
        weatherCode: 95
    }));
    assert.equal(result.level, 'critical');
    assert.ok(result.blockers.some(blocker => blocker.code === 'thunderstorm-weather-code'));
});

test('Safety L: mehrere fehlende Höhenwind-Level ergeben unknown', () => {
    const hour = createHour();
    for (const pressure of [900, 850, 800]) setLevel(hour, pressure, { speedKmh: null });
    const result = assessSafety(hour);
    assert.equal(result.level, 'unknown');
    assert.equal(result.dataQuality.level, 'insufficient');
    assert.ok(result.dataQuality.criticalMissing.includes('family:wind'));
    assert.equal(result.dataQuality.families.wind.assessable, false);
    assert.equal(result.limitingFactor.code, 'critical-missing-data');
});

test('Bekannter Hard Blocker gewinnt trotz überwiegend fehlender Höhenwinde', () => {
    const hour = createHour({ surface: { windSpeedKmh: HARD_SAFETY_THRESHOLDS.wind.surfaceKmh + 1 } });
    for (const pressure of [900, 850, 800]) setLevel(hour, pressure, { speedKmh: null });
    const result = assessSafety(hour);
    assert.equal(result.level, 'critical');
    assert.ok(result.dataQuality.criticalMissing.includes('family:wind'));
    assert.ok(result.blockers.some(blocker => blocker.code === 'surface-wind'));
});

test('Ein fehlender Zusatzwert reduziert Confidence, aber erzwingt kein unknown', () => {
    const result = assessSafety(createHour({ boundaryLayer: { heightM: null } }));
    assert.equal(result.level, 'relaxed');
    assert.equal(result.dataQuality.level, 'partial');
    assert.equal(result.dataQuality.confidence, 'medium');
    assert.equal(result.dataQuality.criticalMissing.length, 0);
});

test('Ein einzelnes fehlendes Höhenwind-Level bleibt bewertbar', () => {
    const hour = setLevel(createHour(), 700, { speedKmh: null, directionDeg: null });
    const result = assessSafety(hour);
    assert.notEqual(result.level, 'unknown');
    assert.equal(result.dataQuality.level, 'partial');
    assert.equal(result.metrics.availableAloftWindLevels, 3);
});

test('Fehlende Böen reduzieren Confidence, erzwingen aber kein unknown', () => {
    const result = assessSafety(createHour({ surface: { gustsKmh: null } }));
    assert.notEqual(result.level, 'unknown');
    assert.equal(result.dataQuality.level, 'partial');
    assert.equal(result.dataQuality.confidence, 'medium');
    assert.equal(result.dataQuality.families.wind.assessable, true);
    assert.ok(result.dataQuality.missing.includes('surface.gustsKmh'));
});

test('Fehlende tiefe Bewölkung bleibt mit vorhandener Sicht bewertbar', () => {
    const result = assessSafety(createHour({ clouds: { lowPct: null } }));
    assert.notEqual(result.level, 'unknown');
    assert.equal(result.dataQuality.level, 'partial');
    assert.equal(result.dataQuality.families.visibilityClouds.assessable, true);
});

test('Eine fehlende Niederschlagsangabe bleibt mit Schauer und Wettercode bewertbar', () => {
    const result = assessSafety(createHour({ precipitation: { amountMm: null } }));
    assert.notEqual(result.level, 'unknown');
    assert.equal(result.dataQuality.level, 'partial');
    assert.equal(result.dataQuality.families.precipitationConvection.assessable, true);
});

test('Eine vollständig fehlende Niederschlags-/Konvektionsfamilie ergibt unknown', () => {
    const result = assessSafety(createHour({
        precipitation: { amountMm: null, probabilityPct: null, showersMm: null },
        weatherCode: null
    }));
    assert.equal(result.level, 'unknown');
    assert.ok(result.dataQuality.criticalMissing.includes('family:precipitationConvection'));
});

test('Safety M: Komfortprofil verändert relaxed/sporty, nicht Hard Blocker', () => {
    const hour = createHour({ surface: { windSpeedKmh: 14, gustsKmh: 15 } });
    const standard = resolveEffectiveLimits(buildCustomLimits(EXPERT_PRESETS.standard.values), true);
    const pro = resolveEffectiveLimits(buildCustomLimits(EXPERT_PRESETS.pro.values), true);
    assert.equal(assessSafety(hour, { limits: standard }).level, 'sporty');
    assert.equal(assessSafety(hour, { limits: pro }).level, 'relaxed');

    const extreme = createHour({ surface: { windSpeedKmh: 30 } });
    assert.equal(assessSafety(extreme, { limits: standard }).level, 'critical');
    assert.equal(assessSafety(extreme, { limits: pro }).level, 'critical');
});

test('Gespeicherte v10-Expertenwerte bleiben ohne Richtungsscherungsfeld gültig', () => {
    const legacyLimits = buildCustomLimits(EXPERT_PRESETS.standard.values);
    delete legacyLimits.wind.directionShear;
    const validated = validateCustomLimits(legacyLimits);
    assert.equal(validated, legacyLimits);

    const result = assessSafety(createHour(), {
        limits: resolveEffectiveLimits(validated, true)
    });
    assert.equal(result.level, 'relaxed');
    assert.deepEqual(result.comfortThresholds.wind.directionShear, { green: 30, yellow: 60 });
});

test('Zentrales Stunden-Assessment enthält genau ein Safety-Ergebnis', () => {
    const assessment = assessNormalizedHour(createHour());
    assert.equal(assessment.safety.level, 'relaxed');
    assert.equal(assessment.dataQuality, assessment.safety.dataQuality);
});

test('Hard Blocker bleibt auch bei deaktivierten Komfortfiltern critical', () => {
    const result = assessSafety(createHour({ precipitation: { amountMm: 3 } }), {
        comfortFilters: { wind: false, clouds: false, precip: false }
    });
    assert.equal(result.level, 'critical');
    assert.ok(result.blockers.some(blocker => blocker.code === 'precipitation'));
});
