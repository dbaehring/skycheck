import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { API_CONFIG } from '../js/config.js';
import { assessNormalizedHour } from '../js/assessment.js';
import {
    buildDashboardHourView,
    buildForecastFreshnessView
} from '../js/dashboard.js';
import { fetchFoehnPressureSeries } from '../js/foehn-pressure-provider.js';
import {
    clearModelForecastCache,
    fetchModelForecastConsensus
} from '../js/model-forecast-provider.js';
import { assessModelConsensusHour } from '../js/model-consensus.js';
import {
    FORECAST_PERIODS,
    isHourInPeriod,
    localHourFromTimestamp
} from '../js/forecast-periods.js';
import { createHour } from './helpers.js';

const TIME = '2026-09-01T12:00';

function dashboardAssessment(overrides = {}) {
    return {
        score: 3,
        hardBlockers: [],
        safety: {
            level: 'relaxed',
            blockers: [],
            limitingFactor: null,
            dataQuality: { criticalMissing: [] }
        },
        thermal: {
            level: 'good',
            metrics: {
                usableThermalDepthM: 1800,
                modelCloudBaseMslM: 2400,
                estimatedLclMslM: 2200,
                shortwaveRadiationWm2: 600,
                windAtThermalTopKmh: 18,
                stability: { category: 'supportive' }
            }
        },
        foehn: { level: 'low', applicability: 'applicable', reasons: [] },
        dataQuality: { stale: false },
        ...overrides
    };
}

function dashboardHour() {
    return {
        time: TIME,
        surface: { windSpeedKmh: 8, gustsKmh: 12 },
        wind: { levels: [
            { pressureHpa: 850, speedKmh: 14, directionDeg: 280, geopotentialHeightMslM: 1550 },
            { pressureHpa: 800, speedKmh: 17, directionDeg: 285, geopotentialHeightMslM: 2050 }
        ] }
    };
}

function consensusModel(id, speed = 15) {
    return {
        id,
        displayName: id,
        hours: [{
            time: TIME,
            surface: { temperatureC: 20, windSpeedKmh: 8, windDirectionDeg: 180 },
            wind: { levels: [850, 800, 700].map((pressureHpa, index) => ({
                pressureHpa,
                speedKmh: speed + index,
                directionDeg: 180,
                temperatureC: 10 - index * 5,
                geopotentialHeightMslM: 1500 + index * 750
            })) },
            clouds: { totalPct: 20, lowPct: 10, midPct: 10, highPct: 5, convectiveBaseMslM: 2400 },
            radiation: { shortwaveWm2: 600 },
            precipitation: { amountMm: 0, showersMm: 0 }
        }]
    };
}

test('RC1 A: fehlende Primärdaten ergeben einen sichtbaren Unklar-Zustand', () => {
    const hour = createHour({
        surface: {
            windSpeedKmh: null,
            windDirectionDeg: null,
            gustsKmh: null,
            visibilityM: null
        },
        wind: { levels: [] },
        clouds: { lowPct: null, totalPct: null },
        precipitation: { amountMm: null, probabilityPct: null, showersMm: null }
    });
    const result = assessNormalizedHour(hour);
    assert.equal(result.safety.level, 'unknown');
    assert.ok(result.safety.dataQuality.criticalMissing.length > 0);
});

test('RC1 B: veralteter Offline-Cache wird ausdrücklich gewarnt', () => {
    const view = buildForecastFreshnessView({
        fromCache: true,
        stale: true,
        cachedAt: '2026-09-01T05:00:00Z'
    });
    assert.equal(view.visible, true);
    assert.equal(view.stale, true);
    assert.match(view.text, /Veraltete Offline-Prognose/);
});

test('RC1 C: Ausfall des Föhnproviders degradiert und nutzt lokale Providerzeit', async () => {
    let requestedUrl = '';
    const result = await fetchFoehnPressureSeries({
        fetchImpl: async url => {
            requestedUrl = url;
            throw new Error('Provider nicht erreichbar');
        }
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'provider-error');
    assert.equal(new URL(requestedUrl).searchParams.get('timezone'), API_CONFIG.timezone);
});

test('RC1 D: Totalausfall des Modellvergleichs lässt Consensus unavailable', async () => {
    clearModelForecastCache();
    const result = await fetchModelForecastConsensus({
        location: { lat: 47.27, lon: 11.4, elevation: 580 },
        primaryHours: [{ time: TIME }],
        primaryAssessments: [dashboardAssessment()],
        fetchImpl: async () => { throw new Error('Alle Provider ausgefallen'); },
        force: true
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.hourly.length, 0);
    assert.ok(result.models.every(model => model.status === 'unavailable'));
});

test('RC1 E: nur zwei Modelle deckeln den Konsens transparent auf Mittel', () => {
    const models = [consensusModel('eins'), consensusModel('zwei')];
    const result = assessModelConsensusHour(
        models.map(model => ({ model, hour: model.hours[0] })),
        TIME
    );
    assert.equal(result.modelCount, 2);
    assert.equal(result.level, 'medium');
    assert.match(result.reasons[0].text, /2 Modelle/);
});

test('RC1 F: kritischer Flugcharakter überschreibt sehr gute Thermik nicht', () => {
    const assessment = dashboardAssessment({
        safety: { level: 'critical', blockers: [{ text: 'Hard Blocker' }], limitingFactor: { text: 'Hard Blocker' }, dataQuality: { criticalMissing: [] } },
        thermal: { level: 'excellent', metrics: { usableThermalDepthM: 2800 } }
    });
    const view = buildDashboardHourView(dashboardHour(), assessment, { level: 'high' });
    assert.equal(view.safety.level, 'critical');
    assert.equal(view.thermal.level, 'excellent');
});

test('RC1 G: unklarer Flugcharakter bleibt von guter Thermik getrennt', () => {
    const assessment = dashboardAssessment({
        safety: { level: 'unknown', blockers: [], limitingFactor: null, dataQuality: { criticalMissing: ['wind.levels'] } }
    });
    const view = buildDashboardHourView(dashboardHour(), assessment, { level: 'medium' });
    assert.equal(view.safety.level, 'unknown');
    assert.equal(view.thermal.level, 'good');
    assert.match(view.dataQualityReason, /wind\.levels/);
});

test('RC1 H: kritisches Föhnrisiko bleibt trotz sonst ruhiger Daten Safety-kritisch', () => {
    const result = assessNormalizedHour(createHour(), {
        foehnAssessment: {
            level: 'critical',
            applicability: 'applicable',
            type: 'south',
            confidence: 'high',
            metrics: { score: 9 },
            reasons: []
        }
    });
    assert.equal(result.foehn.level, 'critical');
    assert.equal(result.safety.level, 'critical');
});

test('RC1 I: lange Ortsnamen und 320-px-Ansicht dürfen nicht horizontal ausbrechen', async () => {
    const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.location-name[^}]*overflow-wrap:\s*anywhere/);
    assert.match(css, /@media \(max-width: 350px\)/);
    assert.match(css, /\.dashboard-heading\s*\{\s*flex-direction:\s*column/);
});

test('RC1 J: Tagesgrenzen folgen lokaler API-Zeit und zentralen Zeiträumen', () => {
    assert.equal(API_CONFIG.timezone, 'auto');
    assert.equal(localHourFromTimestamp('2026-09-02T00:00'), 0);
    assert.equal(isHourInPeriod(6), true);
    assert.equal(isHourInPeriod(20), true);
    assert.equal(isHourInPeriod(21), false);
    assert.equal(FORECAST_PERIODS.consensusCore.label, '10–17 Uhr');
});

test('RC1 K: Legacy-Score beeinflusst die vier v11-Dimensionen nicht', () => {
    const lowLegacy = buildDashboardHourView(dashboardHour(), dashboardAssessment({ score: 1 }), { level: 'high' });
    const highLegacy = buildDashboardHourView(dashboardHour(), dashboardAssessment({ score: 3 }), { level: 'high' });
    assert.deepEqual(
        [lowLegacy.safety.level, lowLegacy.thermal.level, lowLegacy.foehn.level, lowLegacy.confidence.level],
        [highLegacy.safety.level, highLegacy.thermal.level, highLegacy.foehn.level, highLegacy.confidence.level]
    );
});
