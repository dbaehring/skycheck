/**
 * Providerunabhängige Ableitungen für Thermik und XC-Nutzbarkeit.
 * Boundary-Layer-Höhe wird als Schichttiefe über Grund interpretiert;
 * konvektive Wolkenbasis und Geopotentialhöhen liegen über MSL.
 */

import { deriveHourMetrics } from './weather-metrics.js';
import { THERMAL_THRESHOLDS } from './thermal-config.js';

function finiteOrNull(value) {
    return Number.isFinite(value) ? value : null;
}

function roundCloudBaseRange(valueMslM) {
    if (!Number.isFinite(valueMslM)) return null;
    const roundedMslM = Math.round(valueMslM / 100) * 100;
    return {
        lowerMslM: Math.max(0, roundedMslM - 100),
        upperMslM: roundedMslM + 100
    };
}

function localHourFromTimestamp(timestamp) {
    const match = typeof timestamp === 'string' ? timestamp.match(/T(\d{2}):/) : null;
    return match ? Number(match[1]) : null;
}

function levelHeightMsl(level, elevationM) {
    if (Number.isFinite(level.geopotentialHeightMslM)) return level.geopotentialHeightMslM;
    if (Number.isFinite(level.approximateAltitudeM)) return level.approximateAltitudeM;
    return Number.isFinite(elevationM) ? elevationM : null;
}

function deriveStability(hour, elevationM) {
    const config = THERMAL_THRESHOLDS.stability;
    const availableLevels = (hour?.atmosphere?.temperatureLevels || [])
        .filter(level => Number.isFinite(level?.temperatureC) && Number.isFinite(level?.geopotentialHeightMslM))
        .filter(level => elevationM === null || level.geopotentialHeightMslM > elevationM + config.minimumAboveTerrainM)
        .sort((first, second) => first.geopotentialHeightMslM - second.geopotentialHeightMslM);
    const segments = [];

    for (let index = 1; index < availableLevels.length; index++) {
        const lower = availableLevels[index - 1];
        const upper = availableLevels[index];
        const depthM = upper.geopotentialHeightMslM - lower.geopotentialHeightMslM;
        if (depthM < config.minimumLayerDepthM) continue;
        segments.push({
            lowerPressureHpa: lower.pressureHpa,
            upperPressureHpa: upper.pressureHpa,
            lowerHeightMslM: lower.geopotentialHeightMslM,
            upperHeightMslM: upper.geopotentialHeightMslM,
            depthM,
            lapseRateKPerKm: (lower.temperatureC - upper.temperatureC) / depthM * 1000,
            temperatureIncreaseK: Math.max(upper.temperatureC - lower.temperatureC, 0)
        });
    }

    if (segments.length === 0) {
        return {
            category: 'unknown',
            averageLapseRateKPerKm: null,
            segments,
            availableLevelCount: availableLevels.length,
            expectedLevelCount: 6,
            inversion: null
        };
    }

    const inversionSegments = segments.filter(segment => segment.lapseRateKPerKm < config.inversionBelowKPerKm);
    const assessedDepthM = segments.reduce((sum, segment) => sum + segment.depthM, 0);
    const averageLapseRateKPerKm = segments.reduce((sum, segment) =>
        sum + segment.lapseRateKPerKm * segment.depthM, 0
    ) / assessedDepthM;
    const strongestInversion = inversionSegments.sort((first, second) => first.lapseRateKPerKm - second.lapseRateKPerKm)[0] || null;
    const category = strongestInversion
        ? 'inversion'
        : averageLapseRateKPerKm < config.stableBelowKPerKm
            ? 'stable'
            : averageLapseRateKPerKm < config.supportiveFromKPerKm
                ? 'neutral'
                : 'supportive';

    return {
        category,
        averageLapseRateKPerKm,
        segments,
        availableLevelCount: availableLevels.length,
        expectedLevelCount: 6,
        inversion: strongestInversion
    };
}

function deriveThermalWind(hour, common, thermalTopMslM, elevationM) {
    const levels = [
        {
            label: 'Boden',
            speedKmh: common.ws,
            directionDeg: hour?.surface?.windDirectionDeg ?? null,
            heightMslM: elevationM,
            heightSource: 'location'
        },
        ...(hour?.wind?.levels || []).map(level => ({
            label: `${level.pressureHpa} hPa`,
            speedKmh: level.speedKmh ?? null,
            directionDeg: level.directionDeg ?? null,
            heightMslM: levelHeightMsl(level, elevationM),
            heightSource: Number.isFinite(level.geopotentialHeightMslM) ? 'geopotential' : 'approximate'
        }))
    ].filter(level => Number.isFinite(level.speedKmh) && Number.isFinite(level.heightMslM));

    if (levels.length === 0 || !Number.isFinite(thermalTopMslM)) {
        return { windAtThermalTopKmh: null, windAtThermalTopSource: null, boundaryLayerWindKmh: null };
    }

    const topLevel = levels.reduce((closest, level) =>
        Math.abs(level.heightMslM - thermalTopMslM) < Math.abs(closest.heightMslM - thermalTopMslM)
            ? level
            : closest
    );
    const withinLayer = levels.filter(level => level.heightMslM <= thermalTopMslM + 100);
    const boundaryLayerWindKmh = withinLayer.length > 0
        ? withinLayer.reduce((sum, level) => sum + level.speedKmh, 0) / withinLayer.length
        : null;

    return {
        windAtThermalTopKmh: topLevel.speedKmh,
        windAtThermalTopSource: topLevel.heightSource,
        windAtThermalTopLevel: topLevel.label,
        boundaryLayerWindKmh
    };
}

export function deriveThermalMetrics(hour, context = {}) {
    const common = deriveHourMetrics(hour);
    const elevationM = finiteOrNull(hour?.location?.elevation);
    const boundaryLayerDepthAglM = finiteOrNull(hour?.boundaryLayer?.heightM);
    const rawModelCloudBaseMslM = finiteOrNull(hour?.clouds?.convectiveBaseMslM);
    const modelCloudBaseMslM = rawModelCloudBaseMslM !== null &&
        rawModelCloudBaseMslM <= 20000 &&
        (elevationM === null || rawModelCloudBaseMslM > elevationM)
        ? rawModelCloudBaseMslM
        : null;
    const estimatedLclMslM = common.estimatedCloudBaseMslM;
    const cloudBaseMslM = modelCloudBaseMslM ?? estimatedLclMslM;
    const cloudBaseSource = modelCloudBaseMslM !== null
        ? 'modelConvectiveCloudBase'
        : estimatedLclMslM !== null
            ? 'estimatedLcl'
            : 'unknown';
    const modelCloudBaseDepthAglM = modelCloudBaseMslM !== null && elevationM !== null
        ? Math.max(modelCloudBaseMslM - elevationM, 0)
        : null;
    // Die Spread-/LCL-Schätzung bleibt eine Anzeigegröße. Sie ist keine
    // belastbare Obergrenze der konvektiven Grenzschicht (Blauthermik).
    const upperDepthCandidates = [
        boundaryLayerDepthAglM !== null && boundaryLayerDepthAglM > 0
            ? { source: 'boundaryLayer', depthM: boundaryLayerDepthAglM }
            : null,
        modelCloudBaseDepthAglM !== null && modelCloudBaseDepthAglM > 0
            ? { source: 'modelConvectiveCloudBase', depthM: modelCloudBaseDepthAglM }
            : null
    ].filter(Boolean);
    const usableThermalDepthM = upperDepthCandidates.length > 0
        ? Math.round(Math.min(...upperDepthCandidates.map(candidate => candidate.depthM)))
        : null;
    const thermalTopMslM = usableThermalDepthM !== null && elevationM !== null
        ? elevationM + usableThermalDepthM
        : null;
    const shortwaveRadiationWm2 = finiteOrNull(hour?.radiation?.shortwaveWm2);
    const dayPeakRadiationWm2 = finiteOrNull(context.dayPeakRadiationWm2);

    return {
        localHour: localHourFromTimestamp(hour?.time),
        elevationM,
        boundaryLayerDepthAglM,
        cloudBaseMslM,
        cloudBaseSource,
        cloudBaseRangeMslM: roundCloudBaseRange(cloudBaseMslM),
        modelCloudBaseMslM,
        modelCloudBaseDepthAglM,
        estimatedLclMslM,
        estimatedLclRangeMslM: roundCloudBaseRange(estimatedLclMslM),
        usableThermalDepthM,
        thermalTopMslM,
        upperLimitSources: upperDepthCandidates.map(candidate => candidate.source),
        hasReliableHeightLimit: upperDepthCandidates.length > 0,
        stability: deriveStability(hour, elevationM),
        shortwaveRadiationWm2,
        directRadiationWm2: finiteOrNull(hour?.radiation?.directWm2),
        diffuseRadiationWm2: finiteOrNull(hour?.radiation?.diffuseWm2),
        dayPeakRadiationWm2,
        radiationRatioToDayPeak: shortwaveRadiationWm2 !== null && dayPeakRadiationWm2 > 0
            ? Math.min(shortwaveRadiationWm2 / dayPeakRadiationWm2, 1)
            : null,
        cloudCover: {
            totalPct: common.cloudTotal,
            lowPct: common.cloudLow,
            midPct: finiteOrNull(hour?.clouds?.midPct),
            highPct: finiteOrNull(hour?.clouds?.highPct)
        },
        precipitation: {
            amountMm: common.precipitation,
            showersMm: common.showers,
            probabilityPct: common.precipitationProbability
        },
        maxAdjacentSpeedShearKmh: common.maxAdjacentSpeedShearKmh,
        maxAdjacentDirectionShearDeg: common.maxAdjacentDirectionShearDeg,
        updraftMs: finiteOrNull(hour?.convection?.updraftMs),
        ...deriveThermalWind(hour, common, thermalTopMslM, elevationM)
    };
}

export function buildThermalDayContexts(hours) {
    const peaks = new Map();
    for (const hour of hours || []) {
        const day = typeof hour?.time === 'string' ? hour.time.split('T')[0] : null;
        const radiation = finiteOrNull(hour?.radiation?.shortwaveWm2);
        if (!day || radiation === null) continue;
        peaks.set(day, Math.max(peaks.get(day) || 0, radiation));
    }
    return new Map([...peaks].map(([day, dayPeakRadiationWm2]) => [day, { dayPeakRadiationWm2 }]));
}
