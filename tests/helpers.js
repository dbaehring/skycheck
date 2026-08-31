import { evaluateHourlyDataQuality } from '../js/open-meteo-adapter.js';

export function createHour(overrides = {}) {
    const hour = {
        time: '2026-08-31T12:00',
        location: { lat: 47.2692, lon: 11.4041, elevation: 580, name: 'Testort' },
        surface: {
            temperatureC: 20,
            dewPointC: 10,
            windSpeedKmh: 5,
            windDirectionDeg: 180,
            gustsKmh: 8,
            visibilityM: 20000
        },
        wind: {
            levels: [
                { pressureHpa: 900, approximateAltitudeM: 1000, speedKmh: 7, directionDeg: 180 },
                { pressureHpa: 850, approximateAltitudeM: 1500, speedKmh: 9, directionDeg: 185 },
                { pressureHpa: 800, approximateAltitudeM: 2000, speedKmh: 11, directionDeg: 190 },
                { pressureHpa: 700, approximateAltitudeM: 3000, speedKmh: 14, directionDeg: 195 }
            ]
        },
        clouds: { lowPct: 10, midPct: 10, highPct: 10, totalPct: 20 },
        convection: { capeJkg: 0, liftedIndex: 0 },
        precipitation: { amountMm: 0, probabilityPct: 0, showersMm: 0 },
        boundaryLayer: { heightM: 1600 },
        freezingLevelM: 3000,
        weatherCode: 0,
        dataQuality: null
    };

    merge(hour, overrides);
    hour.dataQuality = evaluateHourlyDataQuality(hour, overrides.dataQuality?.stale || false);
    return hour;
}

function merge(target, source) {
    for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') {
            merge(target[key], value);
        } else {
            target[key] = value;
        }
    }
}

export function createDay(dayStr, scores) {
    const hours = [];
    const assessments = [];
    scores.forEach((score, offset) => {
        const hour = 6 + offset;
        hours.push({ time: `${dayStr}T${hour.toString().padStart(2, '0')}:00` });
        assessments.push({ score });
    });
    return { hours, assessments };
}

