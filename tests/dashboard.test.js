import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    buildDashboardDayView,
    buildDashboardHourView,
    findBestWeatherWindow
} from '../js/dashboard.js';

const DAY = '2026-09-01';

function createSeries(overrides = {}) {
    const hours = [];
    const assessments = [];
    for (let localHour = 6; localHour <= 20; localHour++) {
        const time = `${DAY}T${String(localHour).padStart(2, '0')}:00`;
        const hourOverride = overrides[localHour]?.hour || {};
        const assessmentOverride = overrides[localHour]?.assessment || {};
        hours.push({
            time,
            surface: { windSpeedKmh: 8, gustsKmh: 12 },
            wind: { levels: [
                { pressureHpa: 850, speedKmh: 14, directionDeg: 280, geopotentialHeightMslM: 1540 },
                { pressureHpa: 800, speedKmh: 17, directionDeg: 285, geopotentialHeightMslM: 2030 }
            ] },
            ...hourOverride
        });
        const thermalLevel = assessmentOverride.thermal?.level || 'weak';
        assessments.push({
            hardBlockers: [],
            safety: {
                level: 'relaxed',
                blockers: [],
                limitingFactor: null,
                dataQuality: { criticalMissing: [] }
            },
            thermal: {
                level: thermalLevel,
                score: thermalLevel === 'excellent' ? 90 : thermalLevel === 'good' ? 70 : 20,
                reasons: [],
                limitingFactor: null,
                components: { thermalActivity: { precipitationPenalty: 0, cloudPenalty: 0 } },
                metrics: {
                    usableThermalDepthM: thermalLevel === 'excellent' ? 2600 : thermalLevel === 'good' ? 1800 : 400,
                    hasReliableHeightLimit: true,
                    modelCloudBaseMslM: 2800,
                    estimatedLclMslM: 2600,
                    shortwaveRadiationWm2: 600,
                    windAtThermalTopKmh: 18,
                    stability: { category: 'supportive' }
                },
                confidence: { overall: 'high', activity: 'high', height: 'high' }
            },
            foehn: { level: 'low', applicability: 'applicable', reasons: [] },
            dataQuality: { stale: false },
            ...assessmentOverride
        });
    }
    return { hours, assessments };
}

function confidenceSeries(level = 'high') {
    return Array.from({ length: 15 }, (_, offset) => ({
        time: `${DAY}T${String(offset + 6).padStart(2, '0')}:00`,
        level
    }));
}

test('Dashboard A: entspannter Flugcharakter und sehr gute Thermik sind prominent', () => {
    const excellent = {};
    for (let hour = 11; hour <= 15; hour++) {
        excellent[hour] = { assessment: { thermal: thermal('excellent', 92, 2700) } };
    }
    const series = createSeries(excellent);
    const view = buildDashboardDayView(series.hours, series.assessments, DAY, { level: 'high' }, confidenceSeries());
    assert.equal(view.safety.level, 'relaxed');
    assert.equal(view.thermal.level, 'excellent');
});

test('Dashboard B: kritischer Flugcharakter und sehr gute Thermik bleiben getrennt', () => {
    const series = createSeries({
        12: { assessment: {
            hardBlockers: [{ text: 'Gewittersignal' }],
            safety: { level: 'critical', blockers: [{ text: 'Gewittersignal' }], limitingFactor: { text: 'Gewittersignal' }, dataQuality: { criticalMissing: [] } },
            thermal: {
                level: 'excellent', score: 92, reasons: [], limitingFactor: null,
                components: { thermalActivity: { precipitationPenalty: 0, cloudPenalty: 0 } },
                metrics: { usableThermalDepthM: 2700, hasReliableHeightLimit: true },
                confidence: { overall: 'high', activity: 'high', height: 'high' }
            }
        } }
    });
    const hour = buildDashboardHourView(series.hours[6], series.assessments[6], { level: 'high' });
    assert.equal(hour.safety.level, 'critical');
    assert.equal(hour.thermal.level, 'excellent');
});

test('Dashboard C: entspannter Flugcharakter bleibt bei schwacher Thermik sichtbar', () => {
    const series = createSeries();
    const view = buildDashboardDayView(series.hours, series.assessments, DAY, { level: 'high' }, confidenceSeries());
    assert.equal(view.safety.level, 'relaxed');
    assert.equal(view.thermal.level, 'weak');
    assert.equal(view.bestWindow.type, 'quiet');
});

test('Dashboard D: hohes Föhnsignal wird als eigenständige Tagesdimension erhalten', () => {
    const series = createSeries({ 13: { assessment: { foehn: { level: 'high', applicability: 'applicable', reasons: ['Föhnsignal'] } } } });
    const view = buildDashboardDayView(series.hours, series.assessments, DAY, { level: 'high' }, confidenceSeries());
    assert.equal(view.foehn.level, 'high');
    assert.ok(view.hints.some(hint => hint.text.includes('Föhn')));
});

test('Dashboard E: geringer Modellkonsens verändert entspannten Flugcharakter nicht', () => {
    const series = createSeries();
    const view = buildDashboardDayView(series.hours, series.assessments, DAY, { level: 'low' }, confidenceSeries('low'));
    assert.equal(view.safety.level, 'relaxed');
    assert.equal(view.confidence.level, 'low');
});

test('Dashboard F: sehr gute Thermik bleibt bei geringer Höhen-Confidence erhalten', () => {
    const series = createSeries({ 12: { assessment: { thermal: {
        level: 'excellent', score: 90, reasons: [], limitingFactor: null,
        components: { thermalActivity: { precipitationPenalty: 0, cloudPenalty: 0 } },
        metrics: { usableThermalDepthM: null, hasReliableHeightLimit: false, shortwaveRadiationWm2: 650, stability: { category: 'supportive' } },
        confidence: { overall: 'medium', activity: 'high', height: 'low' }
    } } } });
    const view = buildDashboardHourView(series.hours[6], series.assessments[6], { level: 'medium' });
    assert.equal(view.thermal.level, 'excellent');
    assert.match(view.thermalSummary.depth, /n\. v\./);
});

test('Dashboard K: außerhalb des Alpenraums lautet die Föhndimension nicht anwendbar', () => {
    const series = createSeries();
    series.assessments.forEach(assessment => {
        assessment.foehn = { level: 'low', applicability: 'notApplicable', reasons: [] };
    });
    const view = buildDashboardDayView(series.hours, series.assessments, DAY, { level: 'high' }, confidenceSeries());
    assert.equal(view.foehn.level, 'notApplicable');
});

test('Dashboard G: fehlende Kerndaten erklären den unbekannten Flugcharakter', () => {
    const series = createSeries();
    series.assessments.forEach(assessment => {
        assessment.safety = { level: 'unknown', blockers: [], limitingFactor: null, dataQuality: { criticalMissing: ['wind.levels'] } };
    });
    const view = buildDashboardDayView(series.hours, series.assessments, DAY, null, []);
    assert.equal(view.safety.level, 'unknown');
    assert.match(view.dataQualityReason, /wind\.levels/);
});

test('Dashboard H: noch ladender Konsens bleibt ein stabiler unbekannter Zustand', () => {
    const series = createSeries();
    const view = buildDashboardDayView(series.hours, series.assessments, DAY, null, []);
    assert.equal(view.confidence.level, 'unknown');
    assert.equal(view.safety.level, 'relaxed');
    assert.equal(view.thermal.level, 'weak');
});

test('Dashboard I: ein Consensus-Providerfehler lässt die übrigen Dimensionen nutzbar', () => {
    const series = createSeries({ 14: { assessment: { safety: { level: 'sporty', blockers: [], limitingFactor: null, dataQuality: { criticalMissing: [] } } } } });
    const view = buildDashboardHourView(series.hours[8], series.assessments[8], null);
    assert.equal(view.confidence.level, 'unknown');
    assert.equal(view.safety.level, 'sporty');
    assert.equal(view.thermal.level, 'weak');
});

test('Dashboard J: 390-px-Regeln begrenzen die Seite und lassen die Timeline scrollen', async () => {
    const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
    assert.match(css, /html\s*\{\s*overflow-x:\s*hidden/);
    assert.match(css, /\.timeline\s*\{[\s\S]*?overflow-x:\s*auto/);
    assert.match(css, /@media \(max-width: 430px\)/);
});

test('Dashboard L: Tages- und Stundenansicht lesen dieselben Assessment-Level', () => {
    const series = createSeries({ 14: { assessment: { safety: { level: 'sporty', blockers: [], limitingFactor: null, dataQuality: { criticalMissing: [] } } } } });
    const day = buildDashboardDayView(series.hours, series.assessments, DAY, { level: 'high' }, confidenceSeries());
    const hour = buildDashboardHourView(series.hours[8], series.assessments[8], { level: 'high' });
    assert.equal(day.safety.level, 'sporty');
    assert.equal(hour.safety.level, 'sporty');
});

test('Dashboard M: Höhenwind zeigt tatsächliche Geopotentialhöhe mit Druckfläche sekundär', () => {
    const series = createSeries();
    const view = buildDashboardHourView(series.hours[6], series.assessments[6], { level: 'high' });
    assert.match(view.wind.level1500, /1540 m MSL/);
    assert.match(view.wind.level1500, /850 hPa/);
});

test('Dashboard N: das interessante Fenster bevorzugt Dauer vor späterem Einzel-Peak', () => {
    const series = createSeries({
        10: { assessment: { thermal: thermal('good', 70, 1700) } },
        11: { assessment: { thermal: thermal('good', 70, 1700) } },
        12: { assessment: { thermal: thermal('good', 70, 1700) } },
        16: { assessment: { thermal: thermal('excellent', 95, 2800) } }
    });
    const window = findBestWeatherWindow(series.hours, series.assessments, DAY, confidenceSeries());
    assert.deepEqual([window.start, window.end], [10, 12]);
});

function thermal(level, score, depth) {
    return {
        level,
        score,
        reasons: [],
        limitingFactor: null,
        components: { thermalActivity: { precipitationPenalty: 0, cloudPenalty: 0 } },
        metrics: { usableThermalDepthM: depth, hasReliableHeightLimit: true },
        confidence: { overall: 'high', activity: 'high', height: 'high' }
    };
}
