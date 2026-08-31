import test from 'node:test';
import assert from 'node:assert/strict';

import { assessNormalizedHour } from '../js/assessment.js';
import { normalizeOpenMeteoHourly } from '../js/open-meteo-adapter.js';

function completeProviderData() {
    return {
        time: ['2026-08-31T12:00'],
        temperature_2m: [20], dew_point_2m: [10],
        wind_speed_10m: [5], wind_direction_10m: [180], wind_gusts_10m: [8],
        visibility: [20000], cloud_cover: [20], cloud_cover_low: [10], cloud_cover_mid: [10], cloud_cover_high: [10],
        convective_cloud_base: [2600], shortwave_radiation: [600], direct_radiation: [450], diffuse_radiation: [150], updraft: [0.5],
        cape: [0], lifted_index: [0], precipitation: [0], precipitation_probability: [0], showers: [0],
        freezing_level_height: [3000], weather_code: [0], boundary_layer_height: [1600],
        wind_speed_900hPa: [7], wind_speed_850hPa: [9], wind_speed_800hPa: [11], wind_speed_700hPa: [14],
        wind_direction_900hPa: [180], wind_direction_850hPa: [185], wind_direction_800hPa: [190], wind_direction_700hPa: [195],
        temperature_950hPa: [18], temperature_925hPa: [16.4], temperature_900hPa: [14.8],
        temperature_850hPa: [10.8], temperature_800hPa: [6.8], temperature_700hPa: [-1.6],
        geopotential_height_950hPa: [650], geopotential_height_925hPa: [850], geopotential_height_900hPa: [1050],
        geopotential_height_850hPa: [1550], geopotential_height_800hPa: [2050], geopotential_height_700hPa: [3100]
    };
}

test('Open-Meteo-Adapter erzeugt das providerunabhängige Stundenmodell mit dokumentierten Einheiten', () => {
    const [hour] = normalizeOpenMeteoHourly(completeProviderData());
    assert.equal(hour.surface.temperatureC, 20);
    assert.equal(hour.surface.windSpeedKmh, 5);
    assert.equal(hour.surface.visibilityM, 20000);
    assert.equal(hour.wind.levels.find(level => level.pressureHpa === 700).speedKmh, 14);
    assert.equal(hour.precipitation.amountMm, 0);
    assert.equal(hour.convection.capeJkg, 0);
    assert.equal(hour.radiation.shortwaveWm2, 600);
    assert.equal(hour.clouds.convectiveBaseMslM, 2600);
    assert.equal(hour.convection.updraftMs, 0.5);
    assert.equal(hour.wind.levels.find(level => level.pressureHpa === 850).geopotentialHeightMslM, 1550);
    assert.equal(hour.atmosphere.temperatureLevels.find(level => level.pressureHpa === 925).temperatureC, 16.4);
    assert.equal(hour.atmosphere.temperatureLevels.find(level => level.pressureHpa === 950).geopotentialHeightMslM, 650);
    assert.equal(hour.dataQuality.level, 'good');
});

test('Fehlende Werte bleiben null und werden nie zu meteorologisch günstigen Nullen', () => {
    const data = completeProviderData();
    data.wind_speed_700hPa = [null];
    data.cape = [null];
    data.cloud_cover = [null];
    data.precipitation = [null];
    const [hour] = normalizeOpenMeteoHourly(data);
    const assessment = assessNormalizedHour(hour);

    assert.equal(hour.wind.levels.find(level => level.pressureHpa === 700).speedKmh, null);
    assert.equal(hour.convection.capeJkg, null);
    assert.equal(hour.clouds.totalPct, null);
    assert.equal(hour.precipitation.amountMm, null);
    assert.equal(hour.dataQuality.level, 'insufficient');
    assert.equal(assessment.score, 2);
    assert.equal(assessment.categories.wind, null);
    assert.equal(assessment.categories.thermik, null);
    assert.equal(assessment.categories.clouds, null);
    assert.equal(assessment.categories.precip, null);
});

test('Fehlende ergänzende Daten ergeben partial statt stilles GO', () => {
    const data = completeProviderData();
    data.wind_speed_700hPa = [null];
    const [hour] = normalizeOpenMeteoHourly(data);
    const assessment = assessNormalizedHour(hour);
    assert.equal(hour.dataQuality.level, 'partial');
    assert.equal(assessment.categories.wind, null);
    assert.equal(assessment.score, 2);
});

test('Stale-Flag wird übernommen und verhindert ein unmarkiertes GO', () => {
    const [hour] = normalizeOpenMeteoHourly(completeProviderData(), null, { stale: true });
    const assessment = assessNormalizedHour(hour);
    assert.equal(hour.dataQuality.stale, true);
    assert.equal(hour.dataQuality.level, 'partial');
    assert.equal(assessment.score, 2);
});
