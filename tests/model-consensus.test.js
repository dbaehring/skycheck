import test from 'node:test';
import assert from 'node:assert/strict';

import {
    aggregateDailyConsensus,
    assessModelConsensusHour,
    circularDifference
} from '../js/model-consensus.js';
import {
    clearModelForecastCache,
    fetchModelForecastConsensus
} from '../js/model-forecast-provider.js';
import { normalizeModelForecastResponse } from '../js/model-forecast-adapter.js';

const time = '2026-09-01T12:00';

function createModel(id, overrides = {}) {
    const speed = overrides.speed ?? 15;
    const direction = overrides.direction ?? 315;
    const height = overrides.height ?? 2600;
    const precipitation = overrides.precipitation ?? 0;
    const radiation = overrides.radiation ?? 600;
    const cloud = overrides.cloud ?? 20;
    const levels = [850, 800, 700].map((pressureHpa, index) => ({
        pressureHpa,
        speedKmh: overrides.levelSpeeds?.[pressureHpa] ?? speed + index,
        directionDeg: overrides.levelDirections?.[pressureHpa] ?? direction,
        geopotentialHeightMslM: [1550, 2050, 3100][index],
        temperatureC: [10, 6, 0][index],
        source: 'model'
    }));
    return {
        id,
        displayName: id,
        hours: [{
            time,
            modelId: id,
            surface: { temperatureC: 20, windSpeedKmh: speed / 2, windDirectionDeg: direction },
            wind: { levels },
            clouds: { totalPct: cloud, lowPct: cloud, midPct: 10, highPct: 5, convectiveBaseMslM: height },
            radiation: { shortwaveWm2: radiation },
            convection: { capeJkg: 0 },
            precipitation: { amountMm: precipitation, showersMm: precipitation }
        }]
    };
}

function assess(models) {
    return assessModelConsensusHour(models.map(model => ({ model, hour: model.hours[0] })), time);
}

test('A: vier nahezu identische Windprognosen ergeben hohe Confidence', () => {
    const result = assess([
        createModel('d2', { speed: 14, direction: 315 }),
        createModel('eu', { speed: 16, direction: 320, height: 2500 }),
        createModel('arome', { speed: 15, direction: 310, height: 2550 }),
        createModel('ifs', { speed: 15, direction: 318, height: 2620 })
    ]);
    assert.equal(result.components.wind, 'high');
    assert.equal(result.level, 'high');
});

test('B: 12 / 14 / 16 / 27 km/h reduzieren die Wind- und Gesamtconfidence', () => {
    const speeds = [12, 14, 16, 27];
    const result = assess(speeds.map((value, index) => createModel(`m${index}`, {
        levelSpeeds: { 850: value, 800: 15, 700: 17 }
    })));
    assert.equal(result.metrics.wind.levels.find(level => level.pressureHpa === 850).level, 'low');
    assert.equal(result.components.wind, 'medium');
    assert.notEqual(result.level, 'high');
});

test('C: Windrichtungen über 0 Grad werden zirkulär als eng beieinander erkannt', () => {
    assert.equal(circularDifference(350, 10), 20);
    const directions = [350, 5, 10, 355];
    const result = assess(directions.map((value, index) => createModel(`m${index}`, { direction: value })));
    assert.equal(result.components.wind, 'high');
});

test('D: N / W / SW ergeben niedrige Windconfidence', () => {
    const result = assess([0, 270, 225].map((value, index) => createModel(`m${index}`, { direction: value })));
    assert.equal(result.components.wind, 'low');
    assert.equal(result.level, 'low');
});

test('E/F: konsistente Thermikhöhen sind high, große Streuung ist low', () => {
    const consistent = assess([2500, 2600, 2700].map((value, index) => createModel(`c${index}`, { height: value })));
    const divergent = assess([1800, 2700, 3600].map((value, index) => createModel(`d${index}`, { height: value })));
    assert.equal(consistent.components.thermalHeight, 'high');
    assert.equal(divergent.components.thermalHeight, 'low');
});

test('G: zwei trockene und zwei nasse Modelle erzeugen niedrige Confidence', () => {
    const result = assess([0, 0, 0.6, 1.2].map((value, index) => createModel(`m${index}`, { precipitation: value })));
    assert.equal(result.components.precipitation, 'low');
    assert.equal(result.level, 'low');
});

test('H/I: ein fehlendes Modell bleibt bewertbar, nur ein Modell ergibt unknown', () => {
    const threeModels = assess([createModel('d2'), createModel('eu'), createModel('ifs')]);
    const oneModel = assess([createModel('d2')]);
    assert.equal(threeModels.level, 'high');
    assert.equal(threeModels.modelCount, 3);
    assert.equal(oneModel.level, 'unknown');
});

test('J/K: Forecast-Horizont allein verändert die Confidence nicht', () => {
    const divergentToday = assess([0, 90, 180].map((value, index) => createModel(`today${index}`, { direction: value })));
    const agreeingTomorrowModels = [createModel('d2'), createModel('eu'), createModel('ifs')];
    agreeingTomorrowModels.forEach(model => { model.hours[0].time = '2026-09-02T12:00'; });
    const agreeingTomorrow = assessModelConsensusHour(
        agreeingTomorrowModels.map(model => ({ model, hour: model.hours[0] })),
        '2026-09-02T12:00'
    );
    assert.equal(divergentToday.level, 'low');
    assert.equal(agreeingTomorrow.level, 'high');
});

test('L/M: Consensus verändert vorhandene Safety- und Thermal-Level nicht', () => {
    const primary = {
        safety: { level: 'relaxed' },
        thermal: { level: 'excellent' }
    };
    const before = structuredClone(primary);
    assess([0, 90, 180].map((value, index) => createModel(`m${index}`, { direction: value })));
    assert.deepEqual(primary, before);
    assert.equal(primary.safety.level, 'relaxed');
    assert.equal(primary.thermal.level, 'excellent');
});

test('Tagesaggregation gewichtet das Flugfenster statt der schlechtesten Randstunde', () => {
    const hourly = [];
    for (let hour = 6; hour <= 20; hour++) {
        const level = hour < 10 ? 'low' : 'high';
        hourly.push({
            time: `2026-09-01T${hour.toString().padStart(2, '0')}:00`,
            level,
            components: { wind: level, thermal: level, thermalHeight: level, clouds: level, precipitation: level },
            modelCount: 4,
            reasons: [{ code: 'wind-consensus', tone: level === 'low' ? 'negative' : 'positive', text: 'Test' }]
        });
    }
    const [day] = aggregateDailyConsensus(hourly);
    assert.equal(day.level, 'high');
    assert.equal(day.metrics.flightWindow, '06–20 Uhr');
});

test('Modelladapter behält nicht unterstützte Drucklevel als null', () => {
    const modelConfig = {
        id: 'ecmwf_ifs025',
        displayName: 'ECMWF',
        resolution: '0,25°',
        pressureLevels: [850, 700],
        interpolatedPressureLevels: []
    };
    const normalized = normalizeModelForecastResponse(modelConfig, {
        latitude: 47.2,
        longitude: 11.4,
        elevation: 580,
        hourly: {
            time: [time],
            wind_speed_850hPa: [12],
            wind_direction_850hPa: [300],
            wind_speed_700hPa: [18],
            wind_direction_700hPa: [310]
        }
    });
    const level800 = normalized.hours[0].wind.levels.find(level => level.pressureHpa === 800);
    assert.equal(level800.speedKmh, null);
    assert.equal(level800.source, 'unavailable');
});

test('Provider-Ausfall eines Modells lässt Consensus aus drei Modellen zu', async () => {
    clearModelForecastCache();
    const fakeFetch = async url => {
        const parsed = new URL(url);
        const model = parsed.searchParams.get('models');
        if (model === 'geosphere_arome_austria') throw new Error('Simulierter Provider-Ausfall');
        const fields = parsed.searchParams.get('hourly').split(',');
        const hourly = { time: [time] };
        for (const field of fields) {
            let value = 0;
            if (field.startsWith('wind_speed_')) value = 15;
            else if (field.startsWith('wind_direction_')) value = 315;
            else if (field.startsWith('geopotential_height_')) value = field.includes('700') ? 3100 : field.includes('800') ? 2050 : 1550;
            else if (field.startsWith('temperature_')) value = field.includes('700') ? 0 : field.includes('800') ? 6 : field.includes('850') ? 10 : 20;
            else if (field === 'convective_cloud_base') value = 2600;
            else if (field === 'shortwave_radiation') value = 600;
            else if (field.startsWith('cloud_cover')) value = 20;
            hourly[field] = [value];
        }
        return {
            ok: true,
            json: async () => ({ latitude: 47.2, longitude: 11.4, elevation: 580, hourly })
        };
    };
    const result = await fetchModelForecastConsensus({
        location: { lat: 47.2692, lon: 11.4041, elevation: 580 },
        primaryHours: [{ time }],
        primaryAssessments: [{ thermal: { level: 'good' } }],
        fetchImpl: fakeFetch,
        force: true
    });
    assert.equal(result.status, 'ready');
    assert.equal(result.models.filter(model => model.status === 'available').length, 3);
    assert.equal(result.models.find(model => model.id === 'geosphere_arome_austria').status, 'unavailable');
    assert.notEqual(result.daily[0].level, 'unknown');
});
