/**
 * Open-Meteo Adapter
 *
 * Einheiten des normalisierten Stundenmodells:
 * - Temperaturen: °C
 * - Windgeschwindigkeiten: km/h
 * - Windrichtungen: Grad
 * - Sicht und Höhen: m
 * - Bewölkung und Wahrscheinlichkeiten: %
 * - Niederschlag/Schauer: mm
 * - CAPE: J/kg
 *
 * Nur dieses Modul kennt Open-Meteo-Feldnamen. Es normalisiert Daten, nimmt
 * aber keine meteorologische Bewertung vor.
 */

export const OPEN_METEO_MAIN_HOURLY_FIELDS = [
    'temperature_2m',
    'dew_point_2m',
    'precipitation',
    'precipitation_probability',
    'showers',
    'cloud_cover',
    'cloud_cover_low',
    'cloud_cover_mid',
    'cloud_cover_high',
    'visibility',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
    'cape',
    'lifted_index',
    'freezing_level_height',
    'weather_code'
];

export const OPEN_METEO_PRESSURE_HOURLY_FIELDS = [
    'wind_speed_900hPa',
    'wind_speed_850hPa',
    'wind_speed_800hPa',
    'wind_speed_700hPa',
    'wind_direction_900hPa',
    'wind_direction_850hPa',
    'wind_direction_800hPa',
    'wind_direction_700hPa',
    'boundary_layer_height'
];

export const OPEN_METEO_FAVORITE_HOURLY_FIELDS = [
    ...OPEN_METEO_MAIN_HOURLY_FIELDS,
    ...OPEN_METEO_PRESSURE_HOURLY_FIELDS
];

export const OPEN_METEO_DAILY_FIELDS = ['sunrise', 'sunset'];

const PRESSURE_LEVELS = [
    { pressureHpa: 900, approximateAltitudeM: 1000, speed: 'wind_speed_900hPa', direction: 'wind_direction_900hPa' },
    { pressureHpa: 850, approximateAltitudeM: 1500, speed: 'wind_speed_850hPa', direction: 'wind_direction_850hPa' },
    { pressureHpa: 800, approximateAltitudeM: 2000, speed: 'wind_speed_800hPa', direction: 'wind_direction_800hPa' },
    { pressureHpa: 700, approximateAltitudeM: 3000, speed: 'wind_speed_700hPa', direction: 'wind_direction_700hPa' }
];

const CORE_QUALITY_PATHS = [
    'surface.windSpeedKmh',
    'surface.gustsKmh',
    'surface.visibilityM',
    'clouds.lowPct',
    'precipitation.amountMm'
];

const SUPPLEMENTAL_QUALITY_PATHS = [
    'surface.temperatureC',
    'surface.dewPointC',
    'clouds.totalPct',
    'convection.capeJkg',
    'convection.liftedIndex',
    'precipitation.probabilityPct',
    'precipitation.showersMm',
    'boundaryLayer.heightM',
    'wind.levels.900.speedKmh',
    'wind.levels.850.speedKmh',
    'wind.levels.800.speedKmh',
    'wind.levels.700.speedKmh'
];

function numberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function valueAt(source, key, index) {
    return numberOrNull(source?.[key]?.[index]);
}

function getPressureValue(main, pressure, key, index) {
    const preferred = valueAt(pressure, key, index);
    return preferred !== null ? preferred : valueAt(main, key, index);
}

function getPathValue(hour, path) {
    const parts = path.split('.');
    let current = hour;
    for (const part of parts) {
        if (part === '900' || part === '850' || part === '800' || part === '700') {
            current = current?.find?.(level => level.pressureHpa === Number(part));
        } else {
            current = current?.[part];
        }
    }
    return current;
}

export function evaluateHourlyDataQuality(hour, stale = false) {
    const missingCore = CORE_QUALITY_PATHS.filter(path => getPathValue(hour, path) === null);
    const missingSupplemental = SUPPLEMENTAL_QUALITY_PATHS.filter(path => getPathValue(hour, path) === null);
    const missing = [...missingCore, ...missingSupplemental];

    let level = 'good';
    if (!hour.time || missingCore.length > 0) {
        level = 'insufficient';
    } else if (missingSupplemental.length > 0 || stale) {
        level = 'partial';
    }

    return { level, missing, stale: Boolean(stale) };
}

/**
 * Normalisiert die stündlichen Felder einer Open-Meteo-Antwort.
 * Drucklevel dürfen entweder aus einer zweiten Antwort oder aus derselben
 * Antwort (Favoriten-Schnellabfrage) stammen.
 */
export function normalizeOpenMeteoHourly(mainHourly, pressureHourly = null, options = {}) {
    const times = Array.isArray(mainHourly?.time) ? mainHourly.time : [];
    const location = options.location ? { ...options.location } : null;
    const stale = Boolean(options.stale);

    return times.map((time, index) => {
        const hour = {
            time,
            location,
            surface: {
                temperatureC: valueAt(mainHourly, 'temperature_2m', index),
                dewPointC: valueAt(mainHourly, 'dew_point_2m', index),
                windSpeedKmh: valueAt(mainHourly, 'wind_speed_10m', index),
                windDirectionDeg: valueAt(mainHourly, 'wind_direction_10m', index),
                gustsKmh: valueAt(mainHourly, 'wind_gusts_10m', index),
                visibilityM: valueAt(mainHourly, 'visibility', index)
            },
            wind: {
                levels: PRESSURE_LEVELS.map(level => ({
                    pressureHpa: level.pressureHpa,
                    approximateAltitudeM: level.approximateAltitudeM,
                    speedKmh: getPressureValue(mainHourly, pressureHourly, level.speed, index),
                    directionDeg: getPressureValue(mainHourly, pressureHourly, level.direction, index)
                }))
            },
            clouds: {
                lowPct: valueAt(mainHourly, 'cloud_cover_low', index),
                midPct: valueAt(mainHourly, 'cloud_cover_mid', index),
                highPct: valueAt(mainHourly, 'cloud_cover_high', index),
                totalPct: valueAt(mainHourly, 'cloud_cover', index)
            },
            convection: {
                capeJkg: valueAt(mainHourly, 'cape', index),
                liftedIndex: valueAt(mainHourly, 'lifted_index', index)
            },
            precipitation: {
                amountMm: valueAt(mainHourly, 'precipitation', index),
                probabilityPct: valueAt(mainHourly, 'precipitation_probability', index),
                showersMm: valueAt(mainHourly, 'showers', index)
            },
            boundaryLayer: {
                heightM: getPressureValue(mainHourly, pressureHourly, 'boundary_layer_height', index)
            },
            freezingLevelM: valueAt(mainHourly, 'freezing_level_height', index),
            weatherCode: valueAt(mainHourly, 'weather_code', index),
            dataQuality: null
        };

        hour.dataQuality = evaluateHourlyDataQuality(hour, stale);
        return hour;
    });
}
