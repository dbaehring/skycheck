/**
 * Providerunabhängige meteorologische Ableitungen für Assessments.
 * Dieses Modul bewertet nicht, sondern berechnet ausschließlich Messgrößen.
 */

import { LIMITS, METEO_CONSTANTS } from './config.js';

export function getPressureLevel(hour, pressureHpa) {
    return hour?.wind?.levels?.find(level => level.pressureHpa === pressureHpa) || null;
}

export function circularDirectionDifference(firstDeg, secondDeg) {
    if (!Number.isFinite(firstDeg) || !Number.isFinite(secondDeg)) return null;
    const difference = Math.abs(firstDeg - secondDeg) % 360;
    return Math.min(difference, 360 - difference);
}

function buildAdjacentChanges(levels, valueKey, differenceFn) {
    const changes = [];
    for (let index = 1; index < levels.length; index++) {
        const lower = levels[index - 1];
        const upper = levels[index];
        const difference = differenceFn(lower[valueKey], upper[valueKey]);
        if (difference === null) continue;
        changes.push({
            from: lower.label,
            to: upper.label,
            difference
        });
    }
    return changes;
}

function maximumDifference(levels, valueKey, differenceFn) {
    let maximum = null;
    for (let first = 0; first < levels.length; first++) {
        for (let second = first + 1; second < levels.length; second++) {
            const difference = differenceFn(levels[first][valueKey], levels[second][valueKey]);
            if (difference !== null && (maximum === null || difference > maximum)) maximum = difference;
        }
    }
    return maximum;
}

export function deriveHourMetrics(hour) {
    const pressureLevels = [900, 850, 800, 700].map(pressureHpa => getPressureLevel(hour, pressureHpa));
    const flightLevels = [
        {
            label: 'Boden',
            pressureHpa: null,
            speedKmh: hour?.surface?.windSpeedKmh ?? null,
            directionDeg: hour?.surface?.windDirectionDeg ?? null
        },
        ...pressureLevels.map(level => ({
            label: `${level?.pressureHpa ?? '?'} hPa`,
            pressureHpa: level?.pressureHpa ?? null,
            speedKmh: level?.speedKmh ?? null,
            directionDeg: level?.directionDeg ?? null,
            geopotentialHeightMslM: level?.geopotentialHeightMslM ?? null,
            approximateAltitudeM: level?.approximateAltitudeM ?? null
        }))
    ];
    const ws = flightLevels[0].speedKmh;
    const wg = hour?.surface?.gustsKmh ?? null;
    const [w900, w850, w800, w700] = pressureLevels.map(level => level?.speedKmh ?? null);
    const temperature = hour?.surface?.temperatureC ?? null;
    const dewPoint = hour?.surface?.dewPointC ?? null;
    const spread = temperature !== null && dewPoint !== null ? temperature - dewPoint : null;
    const adjacentSpeedChanges = buildAdjacentChanges(
        flightLevels,
        'speedKmh',
        (first, second) => first === null || second === null ? null : Math.abs(second - first)
    );
    const adjacentDirectionChanges = buildAdjacentChanges(
        flightLevels,
        'directionDeg',
        circularDirectionDifference
    );
    const availableAloftLevels = pressureLevels.filter(level => Number.isFinite(level?.speedKmh));
    const aloftSpeeds = availableAloftLevels.map(level => level.speedKmh);
    const strongestAloftWindLevel = availableAloftLevels.reduce((strongest, level) =>
        !strongest || level.speedKmh > strongest.speedKmh ? level : strongest
    , null);
    const elevation = hour?.location?.elevation;

    return {
        ws,
        wg,
        w900,
        w850,
        w800,
        w700,
        flightLevels,
        strongestAloftWindKmh: aloftSpeeds.length > 0 ? Math.max(...aloftSpeeds) : null,
        strongestAloftWindLevel: strongestAloftWindLevel ? {
            pressureHpa: strongestAloftWindLevel.pressureHpa,
            speedKmh: strongestAloftWindLevel.speedKmh,
            directionDeg: strongestAloftWindLevel.directionDeg ?? null,
            geopotentialHeightMslM: strongestAloftWindLevel.geopotentialHeightMslM ?? null,
            approximateAltitudeM: strongestAloftWindLevel.approximateAltitudeM ?? null
        } : null,
        availableAloftWindLevels: aloftSpeeds.length,
        gustSpread: ws !== null && wg !== null ? wg - ws : null,
        gustFactor: ws !== null && wg !== null && ws >= 5 ? (wg - ws) / ws : 0,
        gradient1500: ws !== null && w850 !== null ? Math.abs(w850 - ws) : null,
        gradient3000: ws !== null && w700 !== null ? Math.abs(w700 - ws) : null,
        adjacentSpeedChanges,
        maxAdjacentSpeedShearKmh: adjacentSpeedChanges.length > 0
            ? Math.max(...adjacentSpeedChanges.map(change => change.difference))
            : null,
        adjacentDirectionChanges,
        maxAdjacentDirectionShearDeg: adjacentDirectionChanges.length > 0
            ? Math.max(...adjacentDirectionChanges.map(change => change.difference))
            : null,
        maxOverallDirectionShearDeg: maximumDifference(flightLevels, 'directionDeg', circularDirectionDifference),
        spread,
        estimatedCloudBaseMslM: spread !== null && Number.isFinite(elevation)
            ? Math.round(spread * METEO_CONSTANTS.cloudBaseMultiplier + elevation)
            : null,
        estimatedCloudBaseAboveLocationM: spread !== null
            ? Math.round(spread * METEO_CONSTANTS.cloudBaseMultiplier)
            : null,
        cape: hour?.convection?.capeJkg ?? null,
        liftedIndex: hour?.convection?.liftedIndex ?? null,
        visibility: hour?.surface?.visibilityM ?? null,
        cloudLow: hour?.clouds?.lowPct ?? null,
        cloudTotal: hour?.clouds?.totalPct ?? null,
        precipitation: hour?.precipitation?.amountMm ?? null,
        precipitationProbability: hour?.precipitation?.probabilityPct ?? null,
        showers: hour?.precipitation?.showersMm ?? null,
        weatherCode: hour?.weatherCode ?? null
    };
}

export function getFogRiskFromValues(spread, windSpeed, visibility, limits = LIMITS) {
    if (spread === null || windSpeed === null || visibility === null) return 'unknown';
    if (visibility < limits.fog.visibilitySevere) return 'severe';
    if (spread <= limits.fog.spreadSevere && windSpeed < limits.fog.windThreshold) return 'severe';
    if (spread <= 2.0 && windSpeed < limits.fog.windDisperse && visibility < limits.fog.visibilityWarning) return 'likely';
    if (visibility < limits.fog.visibilityWarning) return 'possible';
    if (spread < limits.fog.spreadWarning && windSpeed < limits.fog.windDisperse) return 'possible';
    return 'unlikely';
}
