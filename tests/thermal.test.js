import test from 'node:test';
import assert from 'node:assert/strict';

import { assessNormalizedHour, assessNormalizedHours } from '../js/assessment.js';
import { assessThermal } from '../js/thermal-engine.js';
import { assessThermalDay, findBestThermalWindow } from '../js/thermal-aggregation.js';
import { createHour } from './helpers.js';

const DAY = '2026-08-31';
const SUNNY_CONTEXT = { dayPeakRadiationWm2: 700 };

function hourAt(localHour, overrides = {}) {
    return createHour({
        time: `${DAY}T${String(localHour).padStart(2, '0')}:00`,
        ...overrides
    });
}

function setAllWindLevels(hour, speeds) {
    hour.wind.levels.forEach((level, index) => {
        level.speedKmh = speeds[index];
    });
    return hour;
}

function setTemperatureProfile(hour, temperatures) {
    hour.atmosphere.temperatureLevels.forEach((level, index) => {
        level.temperatureC = temperatures[index];
    });
    return hour;
}

test('Thermal A: stabiler Wintertag ist weak bei gleichzeitig relaxed Safety', () => {
    const assessment = assessNormalizedHour(hourAt(12, {
        boundaryLayer: { heightM: 300 },
        radiation: { shortwaveWm2: 70, directWm2: 30, diffuseWm2: 40 },
        clouds: { convectiveBaseMslM: 1800 },
        surface: { windSpeedKmh: 3, gustsKmh: 5 }
    }), { thermalContext: SUNNY_CONTEXT });
    assert.equal(assessment.thermal.level, 'weak');
    assert.equal(assessment.safety.level, 'relaxed');
});

test('Thermal B: hohe Grenzschicht, gute Einstrahlung und moderate Bedingungen sind good', () => {
    const result = assessThermal(hourAt(13, {
        boundaryLayer: { heightM: 1800 },
        clouds: { convectiveBaseMslM: 2700, totalPct: 25, lowPct: 20, midPct: 10, highPct: 10 },
        radiation: { shortwaveWm2: 550, directWm2: 420, diffuseWm2: 130 }
    }), { context: SUNNY_CONTEXT });
    assert.equal(result.level, 'good');
    assert.equal(result.metrics.usableThermalDepthM, 1800);
    assert.equal(result.metrics.cloudBaseSource, 'modelConvectiveCloudBase');
    assert.deepEqual(result.metrics.cloudBaseRangeMslM, { lowerMslM: 2600, upperMslM: 2800 });
    assert.equal(result.metrics.strongestWindWithinThermalLayer.speedKmh, 11);
    assert.equal(result.metrics.strongestWindWithinThermalLayer.heightMslM, 2050);
    assert.equal(result.metrics.strongestWindAboveThermalLayer.speedKmh, 14);
    assert.equal(result.metrics.strongestWindAboveThermalLayer.heightMslM, 3100);
});

test('Thermal C: mehrere exzellente Stunden ergeben einen excellent XC-Tag', () => {
    const hours = [11, 12, 13, 14, 15].map((value, index) => hourAt(value, {
        boundaryLayer: { heightM: 2600 },
        clouds: { convectiveBaseMslM: 3400, totalPct: 25, lowPct: 25, midPct: 10, highPct: 10 },
        radiation: { shortwaveWm2: [650, 700, 720, 680, 620][index] }
    }));
    const assessments = assessNormalizedHours(hours);
    const day = assessThermalDay(hours, assessments, DAY);
    assert.ok(assessments.every(assessment => assessment.thermal.level === 'excellent'));
    assert.equal(day.level, 'excellent');
    assert.deepEqual([day.bestThermalWindow.start, day.bestThermalWindow.end], [11, 15]);
});

test('Thermal D: mittlere und hohe Abschirmung verschlechtert gleiche Grenzschicht', () => {
    const open = assessThermal(hourAt(13, {
        boundaryLayer: { heightM: 1800 },
        radiation: { shortwaveWm2: 550 },
        clouds: { convectiveBaseMslM: 2700, totalPct: 25, lowPct: 20, midPct: 10, highPct: 10 }
    }), { context: SUNNY_CONTEXT });
    const shielded = assessThermal(hourAt(13, {
        boundaryLayer: { heightM: 1800 },
        radiation: { shortwaveWm2: 180 },
        clouds: { convectiveBaseMslM: 2700, totalPct: 95, lowPct: 20, midPct: 90, highPct: 95 }
    }), { context: SUNNY_CONTEXT });
    assert.equal(open.level, 'good');
    assert.ok(shielded.score < open.score);
    assert.equal(shielded.level, 'weak');
});

test('Thermal E: spätere Schauer beenden das gute frühe Fenster', () => {
    const hours = [11, 12, 13, 14, 15, 16, 17].map(localHour => hourAt(localHour, {
        boundaryLayer: { heightM: 2300 },
        clouds: { convectiveBaseMslM: 3200, totalPct: localHour >= 16 ? 85 : 25, midPct: localHour >= 16 ? 80 : 10 },
        radiation: { shortwaveWm2: localHour >= 16 ? 180 : 650 },
        precipitation: localHour >= 16
            ? { amountMm: 1.2, probabilityPct: 80, showersMm: 0.8 }
            : { amountMm: 0, probabilityPct: 10, showersMm: 0 }
    }));
    const assessments = assessNormalizedHours(hours);
    const best = findBestThermalWindow(hours, assessments, DAY);
    assert.deepEqual([best.start, best.end], [11, 15]);
    assert.equal(assessments[5].thermal.level, 'weak');
    assert.equal(assessments[6].thermal.level, 'weak');
});

test('Thermal F: hohe CAPE und negativer LI verändern den Thermikscore nicht', () => {
    const base = hourAt(13, { boundaryLayer: { heightM: 1800 } });
    const unstable = hourAt(13, {
        boundaryLayer: { heightM: 1800 },
        convection: { capeJkg: 3000, liftedIndex: -8 }
    });
    const first = assessThermal(base, { context: SUNNY_CONTEXT });
    const second = assessThermal(unstable, { context: SUNNY_CONTEXT });
    assert.equal(second.level, first.level);
    assert.equal(second.score, first.score);
    assert.deepEqual(second.components, first.components);
});

test('Thermal G: sportlicher Höhenwind lässt gute Thermik nutzbar und Safety getrennt', () => {
    const hour = hourAt(13, {
        boundaryLayer: { heightM: 2400 },
        clouds: { convectiveBaseMslM: 3300 },
        radiation: { shortwaveWm2: 680 }
    });
    setAllWindLevels(hour, [15, 22, 27, 28]);
    const assessment = assessNormalizedHour(hour, { thermalContext: SUNNY_CONTEXT });
    assert.ok(['good', 'excellent'].includes(assessment.thermal.level));
    assert.ok(['sporty', 'demanding'].includes(assessment.safety.level));
});

test('Thermal H: critical Safety überschreibt excellent Thermal nicht', () => {
    const assessment = assessNormalizedHour(hourAt(13, {
        surface: { windSpeedKmh: 23, gustsKmh: 25 },
        boundaryLayer: { heightM: 2600 },
        clouds: { convectiveBaseMslM: 3400 },
        radiation: { shortwaveWm2: 700 }
    }), { thermalContext: SUNNY_CONTEXT });
    assert.equal(assessment.safety.level, 'critical');
    assert.equal(assessment.thermal.level, 'excellent');
});

test('Thermal I: fehlender optionaler Updraft verhindert die Bewertung nicht', () => {
    const result = assessThermal(hourAt(13, {
        convection: { updraftMs: null },
        boundaryLayer: { heightM: 1800 }
    }), { context: SUNNY_CONTEXT });
    assert.equal(result.level, 'good');
    assert.notEqual(result.confidence.overall, 'low');
    assert.ok(result.dataQuality.missing.includes('convection.updraftMs'));
});

test('Thermal J: fehlende zentrale Strahlungsdaten ergeben unknown', () => {
    const result = assessThermal(hourAt(13, {
        radiation: { shortwaveWm2: null, directWm2: null, diffuseWm2: null }
    }), { context: SUNNY_CONTEXT });
    assert.equal(result.level, 'unknown');
    assert.ok(result.dataQuality.criticalMissing.includes('family:radiation'));
});

test('Thermal J2: fehlende vertikale Obergrenze lässt belastbare Aktivität good', () => {
    const result = assessThermal(hourAt(13, {
        surface: { temperatureC: null, dewPointC: null },
        boundaryLayer: { heightM: null },
        clouds: { convectiveBaseMslM: null }
    }), { context: SUNNY_CONTEXT });
    assert.equal(result.level, 'good');
    assert.equal(result.metrics.usableThermalDepthM, null);
    assert.equal(result.metrics.strongestWindWithinThermalLayer, null);
    assert.equal(result.metrics.strongestWindAboveThermalLayer, null);
    assert.equal(result.confidence.height, 'low');
});

test('Thermal K: einzelner excellent Peak macht den Tag nicht excellent', () => {
    const hours = [9, 10, 11, 12, 13, 14, 15].map(localHour => hourAt(localHour, localHour === 13
        ? { boundaryLayer: { heightM: 2600 }, clouds: { convectiveBaseMslM: 3400 }, radiation: { shortwaveWm2: 700 } }
        : { boundaryLayer: { heightM: 300 }, clouds: { convectiveBaseMslM: 1800 }, radiation: { shortwaveWm2: 80 } }));
    const assessments = assessNormalizedHours(hours);
    const day = assessThermalDay(hours, assessments, DAY);
    assert.equal(assessments[4].thermal.level, 'excellent');
    assert.notEqual(day.level, 'excellent');
});

test('Thermal L: fünf zusammenhängende good Stunden ergeben guten Tag und XC-Fenster', () => {
    const hours = [10, 11, 12, 13, 14].map(localHour => hourAt(localHour, {
        boundaryLayer: { heightM: 1800 },
        clouds: { convectiveBaseMslM: 2800 },
        radiation: { shortwaveWm2: 560 }
    }));
    const assessments = assessNormalizedHours(hours);
    const day = assessThermalDay(hours, assessments, DAY);
    assert.ok(assessments.every(assessment => assessment.thermal.level === 'good'));
    assert.equal(day.level, 'good');
    assert.deepEqual([day.bestThermalWindow.start, day.bestThermalWindow.end], [10, 14]);
});

test('Spread-Wolkenbasis bleibt reine LCL-Anzeige ohne Scheingenauigkeit', () => {
    const result = assessThermal(hourAt(13, {
        boundaryLayer: { heightM: null },
        clouds: { convectiveBaseMslM: null }
    }), { context: SUNNY_CONTEXT });
    assert.equal(result.metrics.cloudBaseSource, 'estimatedLcl');
    assert.equal(result.metrics.usableThermalDepthM, null);
    assert.equal(result.confidence.height, 'low');
});

test('Kalibrierung A/F/G: Blauthermik nutzt hohes LCL nicht als Obergrenze', () => {
    const result = assessThermal(hourAt(13, {
        surface: { temperatureC: 30, dewPointC: 3 },
        boundaryLayer: { heightM: null },
        clouds: { convectiveBaseMslM: null, totalPct: 10, lowPct: 5, midPct: 5, highPct: 5 },
        radiation: { shortwaveWm2: 680 }
    }), { context: SUNNY_CONTEXT });
    assert.equal(result.metrics.cloudBaseSource, 'estimatedLcl');
    assert.ok(result.metrics.estimatedLclMslM > 3000);
    assert.equal(result.metrics.usableThermalDepthM, null);
    assert.equal(result.level, 'good');
    assert.equal(result.confidence.activity, 'high');
    assert.equal(result.confidence.height, 'low');
    assert.ok(result.reasons.some(reason => reason.code === 'height-potential-uncertain'));
    assert.ok(result.dataQuality.optionalMissing.includes('boundaryLayer.heightM'));
});

test('Kalibrierung B: 250 W/m² bei 100 Prozent Tagesmaximum bleibt absolut mäßig', () => {
    const result = assessThermal(hourAt(13, {
        radiation: { shortwaveWm2: 250 },
        clouds: { totalPct: 100, lowPct: 90, midPct: 90, highPct: 90 }
    }), { context: { dayPeakRadiationWm2: 250 } });
    assert.equal(result.components.thermalActivity.radiation, 22);
    assert.ok(result.components.thermalActivity.radiation < 35);
});

test('Kalibrierung C/D: günstiger Gradient schlägt gleiche Einstrahlung mit Inversion', () => {
    const supportiveHour = setTemperatureProfile(hourAt(13), [18, 16.4, 14.8, 10.8, 6.8, -1.6]);
    const inversionHour = setTemperatureProfile(hourAt(13), [18, 19, 16, 12, 8, 0]);
    const supportive = assessThermal(supportiveHour, { context: SUNNY_CONTEXT });
    const inversion = assessThermal(inversionHour, { context: SUNNY_CONTEXT });
    assert.equal(supportive.metrics.stability.category, 'supportive');
    assert.equal(inversion.metrics.stability.category, 'inversion');
    assert.ok(supportive.score > inversion.score);
    assert.ok(inversion.reasons.some(reason => reason.code === 'stability-inversion'));
});

test('Kalibrierung E: hohe modellbasierte Basis liefert belastbare Thermiktiefe', () => {
    const result = assessThermal(hourAt(13, {
        boundaryLayer: { heightM: null },
        clouds: { convectiveBaseMslM: 3380 }
    }), { context: SUNNY_CONTEXT });
    assert.equal(result.metrics.usableThermalDepthM, 2800);
    assert.deepEqual(result.metrics.upperLimitSources, ['modelConvectiveCloudBase']);
    assert.equal(result.confidence.height, 'high');
    assert.equal(result.level, 'excellent');
});

test('Kalibrierung H: ein fehlendes Temperaturniveau erlaubt reduzierte Stability-Confidence', () => {
    const hour = hourAt(13);
    hour.atmosphere.temperatureLevels[2].temperatureC = null;
    const result = assessThermal(hour, { context: SUNNY_CONTEXT });
    assert.notEqual(result.level, 'unknown');
    assert.equal(result.metrics.stability.category, 'supportive');
    assert.ok(result.metrics.stability.segments.length >= 3);
    assert.equal(result.confidence.activity, 'medium');
});

test('Druckflächen unter Gelände werden für Stability ignoriert', () => {
    const hour = hourAt(13, { location: { elevation: 1000 } });
    const result = assessThermal(hour, { context: SUNNY_CONTEXT });
    assert.ok(result.metrics.stability.segments.every(segment => segment.lowerHeightMslM > 1050));
    assert.equal(result.metrics.stability.segments[0].lowerPressureHpa, 850);
});

test('Sentinel-artige Convective Cloud Base wird nicht als Höhenpotenzial verwendet', () => {
    const result = assessThermal(hourAt(13, {
        boundaryLayer: { heightM: null },
        clouds: { convectiveBaseMslM: 99999 }
    }), { context: SUNNY_CONTEXT });
    assert.equal(result.metrics.modelCloudBaseMslM, null);
    assert.equal(result.metrics.usableThermalDepthM, null);
    assert.equal(result.confidence.height, 'low');
});

test('Kalibrierung I: starker diagnostischer Updraft verändert keine Punkte', () => {
    const baseline = assessThermal(hourAt(13, { convection: { updraftMs: 0.2 } }), { context: SUNNY_CONTEXT });
    const strong = assessThermal(hourAt(13, { convection: { updraftMs: 12 } }), { context: SUNNY_CONTEXT });
    assert.equal(strong.score, baseline.score);
    assert.deepEqual(strong.components, baseline.components);
    assert.equal(strong.components.updraftSignal, 0);
});

test('Langer guter Aktivitätstag ohne Höhenobergrenze bleibt good und behält sein Fenster', () => {
    const hours = [10, 11, 12, 13, 14].map(localHour => hourAt(localHour, {
        boundaryLayer: { heightM: null },
        clouds: { convectiveBaseMslM: null },
        radiation: { shortwaveWm2: 650 }
    }));
    const assessments = assessNormalizedHours(hours);
    const day = assessThermalDay(hours, assessments, DAY);
    assert.ok(assessments.every(assessment => assessment.thermal.level === 'good'));
    assert.equal(day.level, 'good');
    assert.deepEqual([day.bestThermalWindow.start, day.bestThermalWindow.end], [10, 14]);
    assert.equal(day.metrics.reliableHeightHours, 0);
    assert.equal(day.confidence.height, 'low');
});
