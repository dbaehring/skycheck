import test from 'node:test';
import assert from 'node:assert/strict';

import { assessNormalizedHour, resolveEffectiveLimits } from '../js/assessment.js';
import { buildCustomLimits, EXPERT_PRESETS } from '../js/expert-profiles.js';
import { assessFoehn, assessFoehnHours } from '../js/foehn-engine.js';
import { fetchFoehnPressureSeries } from '../js/foehn-pressure-provider.js';
import { assessSafety } from '../js/safety-engine.js';
import { createHour } from './helpers.js';

const DAY = '2026-08-31';

function pressure(time, deltaHpa) {
    return {
        time,
        bozenPressureMslHpa: 1015 + deltaHpa,
        innsbruckPressureMslHpa: 1015,
        bozenMinusInnsbruckHpa: deltaHpa
    };
}

function hourAt(localHour) {
    return createHour({ time: `${DAY}T${String(localHour).padStart(2, '0')}:00` });
}

function setFoehnFlow(hour, directionDeg, speedKmh) {
    for (const pressureHpa of [850, 800, 700]) {
        const level = hour.wind.levels.find(item => item.pressureHpa === pressureHpa);
        level.directionDeg = directionDeg;
        level.speedKmh = speedKmh;
    }
    return hour;
}

function removeFoehnFlow(hour) {
    for (const pressureHpa of [850, 800, 700]) {
        const level = hour.wind.levels.find(item => item.pressureHpa === pressureHpa);
        level.directionDeg = null;
        level.speedKmh = null;
    }
    return hour;
}

function buildCriticalFoehn() {
    const previous = setFoehnFlow(hourAt(12), 195, 30);
    const current = setFoehnFlow(hourAt(13), 195, 40);
    const result = assessFoehnHours([previous, current], {
        pressureSeries: [pressure(previous.time, 4), pressure(current.time, 7)]
    });
    return { current, foehn: result[1] };
}

test('Föhn A: schwacher Westwind und geringer Gradient ergeben low', () => {
    const hour = setFoehnFlow(hourAt(12), 270, 10);
    const result = assessFoehn(hour, { pressure: pressure(hour.time, 0.5) });
    assert.equal(result.level, 'low');
    assert.equal(result.type, 'none');
});

test('Föhn B: deutlicher Druckgradient allein ist nicht high', () => {
    const hour = setFoehnFlow(hourAt(12), 270, 30);
    const result = assessFoehn(hour, { pressure: pressure(hour.time, 4) });
    assert.notEqual(result.level, 'high');
    assert.notEqual(result.level, 'critical');
    assert.equal(result.type, 'south');
    assert.equal(result.confidence, 'medium');
});

test('Föhn C: kräftige Südströmung ohne Druckunterstützung bleibt elevated', () => {
    const hour = setFoehnFlow(hourAt(12), 195, 35);
    const result = assessFoehn(hour, { pressure: pressure(hour.time, 0.5) });
    assert.equal(result.level, 'elevated');
    assert.equal(result.type, 'south');
});

test('Föhn D: konsistenter Südföhn über mehrere Stunden wird high', () => {
    const hours = [11, 12, 13].map(localHour => setFoehnFlow(hourAt(localHour), 195, 35));
    const results = assessFoehnHours(hours, {
        pressureSeries: hours.map(hour => pressure(hour.time, 4))
    });
    assert.equal(results[2].level, 'high');
    assert.equal(results[2].type, 'south');
    assert.equal(results[2].trend, 'steady');
    assert.equal(results[2].metrics.flow.selected.matchingLevelCount, 3);
});

test('Föhn E: starker, zunehmender und konsistenter Fall wird critical', () => {
    const { foehn } = buildCriticalFoehn();
    assert.equal(foehn.level, 'critical');
    assert.equal(foehn.trend, 'increasing');
    assert.equal(foehn.confidence, 'high');
});

test('Föhn F: nachlassende Druck- und Windkomponenten ergeben decreasing', () => {
    const previous = setFoehnFlow(hourAt(12), 195, 45);
    const current = setFoehnFlow(hourAt(13), 195, 35);
    const results = assessFoehnHours([previous, current], {
        pressureSeries: [pressure(previous.time, 7), pressure(current.time, 4)]
    });
    assert.equal(results[1].trend, 'decreasing');
    assert.notEqual(results[1].level, 'critical');
});

test('Föhntrend erkennt eine Drehung in die alpenquerende Richtung', () => {
    const previous = setFoehnFlow(hourAt(12), 270, 35);
    const current = setFoehnFlow(hourAt(13), 195, 35);
    const results = assessFoehnHours([previous, current], {
        pressureSeries: [pressure(previous.time, 4), pressure(current.time, 4)]
    });
    assert.equal(results[1].trend, 'increasing');
});

test('Föhn G: fehlende Druckdaten erlauben Winddiagnose mit mittlerer Confidence', () => {
    const result = assessFoehn(setFoehnFlow(hourAt(12), 195, 35));
    assert.equal(result.level, 'elevated');
    assert.equal(result.confidence, 'medium');
    assert.equal(result.metrics.pressure.deltaHpa, null);
});

test('Föhn H: Druckgradient ohne Windprofil bleibt vorsichtig und wenig sicher', () => {
    const hour = removeFoehnFlow(hourAt(12));
    const result = assessFoehn(hour, { pressure: pressure(hour.time, 7) });
    assert.equal(result.level, 'elevated');
    assert.equal(result.confidence, 'low');
});

test('Föhn I: außerhalb des Alpenraums ist die Diagnose neutral und nicht anwendbar', () => {
    const hour = setFoehnFlow(hourAt(12), 195, 50);
    hour.location = { lat: 40.7128, lon: -74.006 };
    const result = assessFoehn(hour, { pressure: pressure(hour.time, 8) });
    assert.equal(result.level, 'low');
    assert.equal(result.applicability, 'notApplicable');
});

test('Föhn: ohne Druck und relevantes Windprofil ist die Diagnose unknown', () => {
    const result = assessFoehn(removeFoehnFlow(hourAt(12)));
    assert.equal(result.level, 'unknown');
    assert.equal(result.confidence, 'low');
});

test('Föhn: Nordföhn wird mit umgekehrtem Vorzeichen symmetrisch erkannt', () => {
    const previous = setFoehnFlow(hourAt(12), 330, 35);
    const current = setFoehnFlow(hourAt(13), 330, 35);
    const results = assessFoehnHours([previous, current], {
        pressureSeries: [pressure(previous.time, -4), pressure(current.time, -4)]
    });
    assert.equal(results[1].type, 'north');
    assert.equal(results[1].level, 'high');
});

test('Föhn J: critical bleibt in allen Expertenprofilen Safety-critical', () => {
    const { current, foehn } = buildCriticalFoehn();
    for (const name of ['beginner', 'standard', 'pro']) {
        const limits = resolveEffectiveLimits(buildCustomLimits(EXPERT_PRESETS[name].values), true);
        const safety = assessSafety(current, { limits, foehn });
        assert.equal(safety.level, 'critical');
        assert.ok(safety.blockers.some(blocker => blocker.code === 'foehn-critical'));
    }
    const assessment = assessNormalizedHour(current, { foehnAssessment: foehn });
    assert.equal(assessment.safety.level, 'critical');
    assert.equal(assessment.score, 1);
    assert.ok(assessment.hardBlockers.some(blocker => blocker.code === 'foehn-critical'));
});

test('Föhn high verschlechtert Safety ohne zweiten Critical-Windblocker', () => {
    const previous = setFoehnFlow(hourAt(12), 195, 35);
    const current = setFoehnFlow(hourAt(13), 195, 35);
    current.surface.windSpeedKmh = 20;
    current.surface.gustsKmh = 22;
    Object.assign(current.wind.levels.find(level => level.pressureHpa === 900), {
        directionDeg: 195,
        speedKmh: 25
    });
    const foehn = assessFoehnHours([previous, current], {
        pressureSeries: [pressure(previous.time, 4), pressure(current.time, 4)]
    })[1];
    const safety = assessSafety(current, { foehn });
    assert.equal(foehn.level, 'high');
    assert.equal(safety.level, 'demanding');
    assert.equal(safety.blockers.length, 0);
    assert.equal(safety.reasons.filter(reason => reason.code === 'foehn-high').length, 1);
});

test('Föhn-Druckprovider berechnet Bozen minus Innsbruck aus MSL-Druck', async () => {
    const times = [`${DAY}T12:00`, `${DAY}T13:00`];
    let requestCount = 0;
    const fakeFetch = async url => {
        requestCount += 1;
        assert.match(url, /latitude=46\.4983%2C47\.2692/);
        return {
            ok: true,
            async json() {
                return [
                    { hourly: {
                        time: times,
                        pressure_msl: [1018.2, 1019.4]
                    } },
                    { hourly: {
                        time: times,
                        pressure_msl: [1014.0, 1014.1]
                    } }
                ];
            }
        };
    };
    const result = await fetchFoehnPressureSeries({ fetchImpl: fakeFetch, timeoutMs: 100 });
    assert.equal(result.status, 'available');
    assert.equal(requestCount, 1);
    assert.equal(result.definition, 'bozenPressureMslHpa - innsbruckPressureMslHpa');
    assert.deepEqual(result.series.map(item => item.bozenMinusInnsbruckHpa), [4.2, 5.3]);
});

test('Föhn-Druckprovider degradiert bei Provider-Ausfall kontrolliert', async () => {
    const result = await fetchFoehnPressureSeries({
        fetchImpl: async () => { throw new Error('offline'); },
        timeoutMs: 100
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'provider-error');
    assert.deepEqual(result.series, []);
});

test('Föhn-Druckprovider beendet blockierte Abrufe per Timeout', async () => {
    const blockedFetch = (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        }, { once: true });
    });
    const result = await fetchFoehnPressureSeries({ fetchImpl: blockedFetch, timeoutMs: 5 });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'timeout');
});
