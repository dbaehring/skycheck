/**
 * Konfiguration fuer den reinen Modellvergleich.
 *
 * Die Modelle werden absichtlich nicht nach Aufloesung gewichtet. Regionale
 * Modelle sind diagnostisch wertvoll, die Confidence entsteht aber aus der
 * Uebereinstimmung der tatsaechlich verfuegbaren Werte.
 */

export const CONSENSUS_PRESSURE_LEVELS = [850, 800, 700];

const SURFACE_FIELDS = [
    'wind_speed_10m',
    'wind_direction_10m',
    'precipitation',
    'showers',
    'cloud_cover',
    'cloud_cover_low',
    'cloud_cover_mid',
    'cloud_cover_high',
    'shortwave_radiation',
    'temperature_2m',
    'cape'
];

function pressureFields(levels) {
    return levels.flatMap(level => [
        `wind_speed_${level}hPa`,
        `wind_direction_${level}hPa`,
        `geopotential_height_${level}hPa`,
        `temperature_${level}hPa`
    ]);
}

export const MODEL_FORECAST_CONFIG = Object.freeze([
    {
        id: 'icon_d2',
        displayName: 'ICON-D2',
        resolution: '2 km',
        coverage: 'iconD2',
        pressureLevels: [850, 800, 700],
        interpolatedPressureLevels: [800],
        hourlyFields: [...SURFACE_FIELDS, 'convective_cloud_base', ...pressureFields([850, 800, 700])]
    },
    {
        id: 'icon_eu',
        displayName: 'ICON-EU',
        resolution: '7 km',
        coverage: 'iconEu',
        pressureLevels: [850, 800, 700],
        interpolatedPressureLevels: [],
        hourlyFields: [...SURFACE_FIELDS, 'convective_cloud_base', ...pressureFields([850, 800, 700])]
    },
    {
        id: 'geosphere_arome_austria',
        displayName: 'AROME Austria',
        resolution: '2,5 km',
        coverage: 'alps',
        pressureLevels: [],
        interpolatedPressureLevels: [],
        hourlyFields: [...SURFACE_FIELDS]
    },
    {
        id: 'ecmwf_ifs025',
        displayName: 'ECMWF IFS 0,25°',
        resolution: '0,25°',
        coverage: 'global',
        pressureLevels: [850, 700],
        interpolatedPressureLevels: [],
        hourlyFields: [...SURFACE_FIELDS, ...pressureFields([850, 700])]
    }
]);

export const FORECAST_CONFIDENCE_THRESHOLDS = Object.freeze({
    minimumModels: 2,
    highMinimumModels: 3,
    calmDirectionSpeedKmh: 4,
    wind: {
        speedRangeKmh: { high: 5, medium: 12 },
        speedMadKmh: { high: 2.5, medium: 5 },
        directionSpreadDeg: { high: 20, medium: 45 }
    },
    thermalHeight: {
        rangeM: { high: 250, medium: 600 },
        madM: { high: 120, medium: 300 }
    },
    radiation: {
        rangeWm2: { high: 80, medium: 180 },
        madWm2: { high: 40, medium: 90 }
    },
    stability: {
        rangeC: { high: 1.5, medium: 3 },
        madC: { high: 0.75, medium: 1.5 }
    },
    clouds: {
        rangePct: { high: 20, medium: 45 },
        madPct: { high: 10, medium: 22.5 }
    },
    precipitation: {
        wetThresholdMm: 0.1,
        amountRangeMm: { high: 0.5, medium: 2 }
    },
    cacheTtlMs: 30 * 60 * 1000,
    failedModelCacheTtlMs: 5 * 60 * 1000
});
