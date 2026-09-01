/**
 * Normalisierung einzelner Open-Meteo-Modellantworten fuer den Consensus-Pfad.
 * Fehlende oder vom Modell nicht definierte Felder bleiben immer null.
 */

import { CONSENSUS_PRESSURE_LEVELS } from './forecast-confidence-config.js';

function numberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function valueAt(hourly, key, index) {
    return numberOrNull(hourly?.[key]?.[index]);
}

function positiveHeightOrNull(value) {
    const height = numberOrNull(value);
    return height !== null && height > 0 ? height : null;
}

function hasComparableValue(hour) {
    return hour.surface.windSpeedKmh !== null ||
        hour.wind.levels.some(level => level.speedKmh !== null) ||
        hour.clouds.totalPct !== null ||
        hour.precipitation.amountMm !== null ||
        hour.radiation.shortwaveWm2 !== null;
}

export function normalizeModelForecastResponse(modelConfig, response) {
    const hourly = response?.hourly;
    const times = Array.isArray(hourly?.time) ? hourly.time : [];
    const interpolatedLevels = new Set(modelConfig.interpolatedPressureLevels || []);
    const supportedLevels = new Set(modelConfig.pressureLevels || []);

    const hours = times.map((time, index) => {
        const levels = CONSENSUS_PRESSURE_LEVELS.map(pressureHpa => {
            const supported = supportedLevels.has(pressureHpa);
            return {
                pressureHpa,
                speedKmh: supported ? valueAt(hourly, `wind_speed_${pressureHpa}hPa`, index) : null,
                directionDeg: supported ? valueAt(hourly, `wind_direction_${pressureHpa}hPa`, index) : null,
                geopotentialHeightMslM: supported ? valueAt(hourly, `geopotential_height_${pressureHpa}hPa`, index) : null,
                temperatureC: supported ? valueAt(hourly, `temperature_${pressureHpa}hPa`, index) : null,
                source: !supported ? 'unavailable' : interpolatedLevels.has(pressureHpa) ? 'interpolated' : 'model'
            };
        });

        return {
            time,
            modelId: modelConfig.id,
            surface: {
                temperatureC: valueAt(hourly, 'temperature_2m', index),
                windSpeedKmh: valueAt(hourly, 'wind_speed_10m', index),
                windDirectionDeg: valueAt(hourly, 'wind_direction_10m', index)
            },
            wind: { levels },
            clouds: {
                totalPct: valueAt(hourly, 'cloud_cover', index),
                lowPct: valueAt(hourly, 'cloud_cover_low', index),
                midPct: valueAt(hourly, 'cloud_cover_mid', index),
                highPct: valueAt(hourly, 'cloud_cover_high', index),
                convectiveBaseMslM: positiveHeightOrNull(hourly?.convective_cloud_base?.[index])
            },
            radiation: {
                shortwaveWm2: valueAt(hourly, 'shortwave_radiation', index)
            },
            convection: {
                capeJkg: valueAt(hourly, 'cape', index)
            },
            precipitation: {
                amountMm: valueAt(hourly, 'precipitation', index),
                showersMm: valueAt(hourly, 'showers', index)
            }
        };
    });

    return {
        id: modelConfig.id,
        displayName: modelConfig.displayName,
        resolution: modelConfig.resolution,
        pressureLevels: [...modelConfig.pressureLevels],
        grid: {
            latitude: numberOrNull(response?.latitude),
            longitude: numberOrNull(response?.longitude),
            elevationM: numberOrNull(response?.elevation)
        },
        hours,
        comparableHourCount: hours.filter(hasComparableValue).length
    };
}
