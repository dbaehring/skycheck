/**
 * Phase 2a: reine Safety-/Komfortbewertung.
 *
 * Die Engine beschreibt den prognostizierten Flugcharakter. Hard Blocker sind
 * nicht übersteuerbare Hinweise auf kritische Wetterindikatoren, aber weder
 * allgemeine Flugverbote noch eine Flugfreigabe. Die Engine enthält bewusst
 * keinen Thermik-/XC-Score. Das separate Föhnassessment wirkt ausschließlich
 * als Diagnose-Level bzw. nicht übersteuerbarer Blocker, nicht als zweiter
 * numerischer Windabzug.
 */

import { LIMITS } from './config.js';
import {
    HARD_SAFETY_THRESHOLDS,
    SAFETY_LEVEL_RANK,
    buildComfortThresholds
} from './safety-config.js';
import { deriveHourMetrics, getFogRiskFromValues } from './weather-metrics.js';

const LEVEL_LABELS = Object.freeze({
    relaxed: 'Relaxed',
    sporty: 'Sportlich',
    demanding: 'Anspruchsvoll',
    critical: 'Kritisch',
    unknown: 'Unklar'
});

function unique(values) {
    return [...new Set(values)];
}

function safetyDataQuality(hour, metrics) {
    const missing = [...(hour?.dataQuality?.missing || [])];
    const noteMissing = (value, path) => {
        if (value === null || value === undefined) missing.push(path);
    };

    noteMissing(metrics.ws, 'surface.windSpeedKmh');
    noteMissing(metrics.wg, 'surface.gustsKmh');
    noteMissing(metrics.visibility, 'surface.visibilityM');
    noteMissing(metrics.cloudLow, 'clouds.lowPct');
    noteMissing(metrics.precipitation, 'precipitation.amountMm');
    noteMissing(hour?.surface?.windDirectionDeg ?? null, 'surface.windDirectionDeg');
    noteMissing(metrics.spread, 'surface.temperature-dewPoint-spread');
    noteMissing(metrics.precipitationProbability, 'precipitation.probabilityPct');
    noteMissing(metrics.showers, 'precipitation.showersMm');
    noteMissing(metrics.cape, 'convection.capeJkg');
    noteMissing(metrics.liftedIndex, 'convection.liftedIndex');
    noteMissing(metrics.weatherCode, 'weatherCode');

    for (const level of metrics.flightLevels.slice(1)) {
        const pressure = level.pressureHpa ?? 'unknown';
        noteMissing(level.speedKmh, `wind.levels.${pressure}.speedKmh`);
        noteMissing(level.directionDeg, `wind.levels.${pressure}.directionDeg`);
    }

    const hasValue = value => value !== null && value !== undefined;
    const families = {
        wind: {
            assessable: hasValue(metrics.ws) && metrics.availableAloftWindLevels >= 2,
            detail: 'Bodenwind und mindestens zwei Höhenwindgeschwindigkeiten'
        },
        visibilityClouds: {
            assessable: hasValue(metrics.visibility) || hasValue(metrics.cloudLow),
            detail: 'Sicht oder tiefe Bewölkung'
        },
        precipitationConvection: {
            assessable: [
                metrics.precipitation,
                metrics.showers,
                metrics.precipitationProbability,
                metrics.weatherCode
            ].some(hasValue),
            detail: 'Mindestens eine Niederschlags-, Schauer-, Wahrscheinlichkeits- oder Wettercode-Angabe'
        }
    };
    const criticalMissing = Object.entries(families)
        .filter(([, family]) => !family.assessable)
        .map(([name]) => `family:${name}`);
    const cleanMissing = unique(missing);
    const stale = Boolean(hour?.dataQuality?.stale);
    const level = criticalMissing.length > 0
        ? 'insufficient'
        : cleanMissing.length > 0 || stale
            ? 'partial'
            : 'good';

    return {
        level,
        missing: cleanMissing,
        criticalMissing,
        families,
        stale,
        confidence: level === 'good' ? 'high' : level === 'partial' && !stale ? 'medium' : 'low'
    };
}

function compareHigh(value, thresholds) {
    if (value === null || value === undefined) return null;
    if (value > thresholds.yellow) return 'demanding';
    if (value > thresholds.green) return 'sporty';
    return 'relaxed';
}

function compareLow(value, thresholds) {
    if (value === null || value === undefined) return null;
    if (value < thresholds.yellow) return 'demanding';
    if (value < thresholds.green) return 'sporty';
    return 'relaxed';
}

function addReason(collection, reason) {
    collection.push({ hardBlocker: false, ...reason });
}

function addBlocker(reasons, blockers, blocker) {
    const normalized = { level: 'critical', hardBlocker: true, ...blocker };
    blockers.push(normalized);
    reasons.push(normalized);
}

function addComfortReason(reasons, enabled, code, category, label, value, thresholds, unit = '', comparator = compareHigh) {
    if (!enabled) return;
    const level = comparator(value, thresholds);
    if (!level || level === 'relaxed') return;
    addReason(reasons, {
        code,
        category,
        level,
        value,
        thresholds,
        text: `${label} ${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`
    });
}

function formatAloftLevel(level, fallbackPressureHpa = null) {
    const pressureHpa = level?.pressureHpa ?? fallbackPressureHpa;
    const heightMslM = Number.isFinite(level?.geopotentialHeightMslM)
        ? Math.round(level.geopotentialHeightMslM)
        : Number.isFinite(level?.approximateAltitudeM)
            ? Math.round(level.approximateAltitudeM)
            : null;
    if (heightMslM !== null && pressureHpa !== null) return `${heightMslM} m MSL (${pressureHpa} hPa)`;
    if (heightMslM !== null) return `${heightMslM} m MSL`;
    return pressureHpa !== null ? `${pressureHpa} hPa` : 'unbekannter Höhe';
}

function windLevelLabel(metrics, pressureHpa) {
    const level = metrics.flightLevels.find(item => item.pressureHpa === pressureHpa);
    return `Wind ${formatAloftLevel(level, pressureHpa)}`;
}

function evaluateHardBlockers(metrics, reasons, blockers) {
    const hard = HARD_SAFETY_THRESHOLDS;
    const windChecks = [
        ['surface-wind', 'wind', 'Bodenwind', metrics.ws, hard.wind.surfaceKmh, ' km/h'],
        ['gusts', 'wind', 'Böen', metrics.wg, hard.wind.gustsKmh, ' km/h'],
        ['gust-spread', 'wind', 'Böendifferenz', metrics.gustSpread, hard.wind.gustSpreadKmh, ' km/h'],
        [
            'aloft-extreme-wind',
            'wind',
            'Stärkster Höhenwind',
            metrics.strongestAloftWindKmh,
            hard.wind.aloftExtremeKmh,
            ` km/h auf ${formatAloftLevel(metrics.strongestAloftWindLevel)}`
        ]
    ];

    for (const [code, category, label, value, threshold, unit] of windChecks) {
        if (value !== null && value > threshold) {
            addBlocker(reasons, blockers, {
                code,
                category,
                value,
                threshold,
                text: `${label} ${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`
            });
        }
    }

    if (metrics.gustFactor > hard.wind.gustFactor && metrics.wg > hard.wind.gustFactorMinWindKmh) {
        addBlocker(reasons, blockers, {
            code: 'gust-factor',
            category: 'wind',
            value: metrics.gustFactor,
            threshold: hard.wind.gustFactor,
            text: `Böenfaktor ${metrics.gustFactor.toFixed(1)}`
        });
    }

    if (metrics.maxAdjacentSpeedShearKmh > hard.wind.adjacentSpeedShearKmh &&
        metrics.strongestAloftWindKmh > hard.wind.adjacentSpeedShearMinAloftKmh) {
        addBlocker(reasons, blockers, {
            code: 'speed-shear-with-strong-wind',
            category: 'wind',
            value: metrics.maxAdjacentSpeedShearKmh,
            threshold: hard.wind.adjacentSpeedShearKmh,
            text: `Starke benachbarte Geschwindigkeitsscherung ${metrics.maxAdjacentSpeedShearKmh.toFixed(1)} km/h bei stärkstem Höhenwind auf ${formatAloftLevel(metrics.strongestAloftWindLevel)}`
        });
    }

    const directionShear = Math.max(
        metrics.maxAdjacentDirectionShearDeg ?? 0,
        metrics.maxOverallDirectionShearDeg ?? 0
    );
    if (directionShear > hard.wind.directionCombinationDeg &&
        metrics.strongestAloftWindKmh > hard.wind.directionCombinationMinAloftKmh) {
        addBlocker(reasons, blockers, {
            code: 'direction-shear-with-strong-wind',
            category: 'wind',
            value: directionShear,
            threshold: hard.wind.directionCombinationDeg,
            text: `Ausgeprägte Richtungsscherung ${Math.round(directionShear)}° bei stärkstem Höhenwind auf ${formatAloftLevel(metrics.strongestAloftWindLevel)}`
        });
    }

    const fogRisk = getFogRiskFromValues(metrics.spread, metrics.ws, metrics.visibility, LIMITS);
    if (metrics.visibility !== null && metrics.visibility < hard.visibility.severeM) {
        addBlocker(reasons, blockers, {
            code: 'severe-visibility',
            category: 'clouds',
            value: metrics.visibility,
            threshold: hard.visibility.severeM,
            text: `Sicht ${(metrics.visibility / 1000).toFixed(1)} km`
        });
    } else if (fogRisk === 'severe') {
        addBlocker(reasons, blockers, {
            code: 'severe-fog',
            category: 'clouds',
            value: metrics.spread,
            threshold: hard.fog.spreadSevereC,
            text: `Ausgeprägtes Nebelrisiko bei ${metrics.spread.toFixed(1)}°C Spread`
        });
    }

    if (metrics.precipitation !== null && metrics.precipitation > hard.precipitation.amountMm) {
        addBlocker(reasons, blockers, {
            code: 'precipitation',
            category: 'precip',
            value: metrics.precipitation,
            threshold: hard.precipitation.amountMm,
            text: `Niederschlag ${metrics.precipitation.toFixed(1)} mm`
        });
    }
    if (metrics.showers !== null && metrics.showers > hard.precipitation.showersMm) {
        addBlocker(reasons, blockers, {
            code: 'showers',
            category: 'precip',
            value: metrics.showers,
            threshold: hard.precipitation.showersMm,
            text: `Schauer ${metrics.showers.toFixed(1)} mm`
        });
    }

    const convection = hard.convection;
    const thunderstormCode = convection.thunderstormWeatherCodes.includes(metrics.weatherCode);
    const showerSignal = (metrics.showers !== null && metrics.showers > convection.showerSignalMm) ||
        convection.showerWeatherCodes.includes(metrics.weatherCode);
    const wetSignal = showerSignal ||
        (metrics.precipitation !== null && metrics.precipitation > convection.showerSignalMm) ||
        thunderstormCode;
    const combinedConvection = metrics.cape !== null && metrics.cape > convection.capeJkg &&
        metrics.liftedIndex !== null && metrics.liftedIndex < convection.liftedIndex &&
        showerSignal;

    if (thunderstormCode || combinedConvection) {
        addBlocker(reasons, blockers, {
            code: thunderstormCode ? 'thunderstorm-weather-code' : 'combined-convection',
            category: 'convection',
            value: metrics.cape,
            threshold: convection.capeJkg,
            text: thunderstormCode
                ? `Gewittersignal im Wettercode ${metrics.weatherCode}`
                : 'Kombiniertes Schauer-/Konvektionsrisiko'
        });
    }

    return { fogRisk, wetSignal, showerSignal };
}

function evaluateComfort(metrics, thresholds, filters, reasons, context) {
    const windEnabled = filters.wind !== false;
    const cloudEnabled = filters.clouds !== false;
    const precipEnabled = filters.precip !== false;
    const wind = thresholds.wind;
    const windChecks = [
        ['surface-wind', 'Bodenwind', metrics.ws, wind.surface],
        ['gusts', 'Böen', metrics.wg, wind.gusts],
        ['gust-spread', 'Böendifferenz', metrics.gustSpread, wind.gustSpread],
        ['wind-900', windLevelLabel(metrics, 900), metrics.w900, wind.w900],
        ['wind-850', windLevelLabel(metrics, 850), metrics.w850, wind.w850],
        ['wind-800', windLevelLabel(metrics, 800), metrics.w800, wind.w800],
        ['wind-700', windLevelLabel(metrics, 700), metrics.w700, wind.w700],
        ['speed-shear-adjacent', 'Geschwindigkeitsscherung', metrics.maxAdjacentSpeedShearKmh, wind.adjacentSpeedShear],
        ['speed-shear-total', 'Windzunahme Boden–3000 m', metrics.gradient3000, wind.surfaceTo3000]
    ];
    for (const [code, label, value, limit] of windChecks) {
        addComfortReason(reasons, windEnabled, code, 'wind', label, value, limit, ' km/h');
    }

    if (windEnabled && metrics.gustFactor > wind.gustFactor.green && metrics.wg > wind.gustFactorMinWind.green) {
        const level = metrics.gustFactor > wind.gustFactor.yellow && metrics.wg > wind.gustFactorMinWind.yellow
            ? 'demanding'
            : 'sporty';
        addReason(reasons, {
            code: 'gust-factor',
            category: 'wind',
            level,
            value: metrics.gustFactor,
            thresholds: wind.gustFactor,
            text: `Böenfaktor ${metrics.gustFactor.toFixed(1)}`
        });
    }

    const directionShear = Math.max(
        metrics.maxAdjacentDirectionShearDeg ?? 0,
        metrics.maxOverallDirectionShearDeg ?? 0
    );
    addComfortReason(
        reasons,
        windEnabled && (metrics.maxAdjacentDirectionShearDeg !== null || metrics.maxOverallDirectionShearDeg !== null),
        'direction-shear',
        'wind',
        'Richtungsscherung',
        directionShear,
        wind.directionShear,
        '°'
    );

    addComfortReason(reasons, cloudEnabled, 'visibility', 'clouds', 'Sicht', metrics.visibility, thresholds.visibility, ' m', compareLow);
    addComfortReason(reasons, cloudEnabled, 'low-clouds', 'clouds', 'Tiefe Bewölkung', metrics.cloudLow, thresholds.clouds.low, '%');
    if (cloudEnabled && (context.fogRisk === 'likely' || context.fogRisk === 'possible')) {
        addReason(reasons, {
            code: 'fog-risk',
            category: 'clouds',
            level: context.fogRisk === 'likely' ? 'demanding' : 'sporty',
            value: metrics.spread,
            text: context.fogRisk === 'likely' ? 'Nebel wahrscheinlich' : 'Nebel oder eingeschränkte Sicht möglich'
        });
    }

    addComfortReason(reasons, precipEnabled, 'precipitation', 'precip', 'Niederschlag', metrics.precipitation, thresholds.precipitation, ' mm');
    addComfortReason(reasons, precipEnabled, 'showers', 'precip', 'Schauer', metrics.showers, thresholds.showers, ' mm');
    if (precipEnabled && metrics.precipitationProbability !== null &&
        metrics.precipitationProbability > thresholds.precipitationProbability.yellow) {
        addReason(reasons, {
            code: 'precipitation-probability',
            category: 'precip',
            level: 'sporty',
            value: metrics.precipitationProbability,
            threshold: thresholds.precipitationProbability.yellow,
            text: `Niederschlagswahrscheinlichkeit ${Math.round(metrics.precipitationProbability)}%`
        });
    }

    const capeElevated = metrics.cape !== null && metrics.cape > LIMITS.cape.green;
    const capeHigh = metrics.cape !== null && metrics.cape > LIMITS.cape.yellow;
    const liUnstable = metrics.liftedIndex !== null && metrics.liftedIndex < LIMITS.liftedIndex.green;
    const liStrong = metrics.liftedIndex !== null && metrics.liftedIndex < LIMITS.liftedIndex.yellow;
    if (precipEnabled && context.wetSignal && ((capeHigh && liUnstable) || (capeElevated && liStrong))) {
        addReason(reasons, {
            code: 'convection-signals',
            category: 'convection',
            level: 'demanding',
            value: metrics.cape,
            text: 'Mehrere konvektive Signale mit Niederschlagsbezug'
        });
    } else if (precipEnabled && context.wetSignal && capeElevated && liUnstable) {
        addReason(reasons, {
            code: 'convection-signals',
            category: 'convection',
            level: 'sporty',
            value: metrics.cape,
            text: 'Erhöhte konvektive Aufmerksamkeit'
        });
    } else if (capeElevated) {
        addReason(reasons, {
            code: 'cape-attention',
            category: 'convection',
            level: null,
            value: metrics.cape,
            text: `CAPE ${Math.round(metrics.cape)} J/kg ohne weitere kritische Signale`
        });
    }
}

function integrateFoehn(foehn, reasons, blockers) {
    if (!foehn || foehn.applicability === 'notApplicable' || foehn.level === 'low') return;
    if (foehn.level === 'critical') {
        addBlocker(reasons, blockers, {
            code: 'foehn-critical',
            category: 'foehn',
            value: foehn.metrics?.score ?? null,
            threshold: FOEHN_SAFETY_POLICY.critical,
            text: 'Starke, konsistente Föhnindikatoren'
        });
        return;
    }
    if (foehn.level === 'high') {
        addReason(reasons, {
            code: 'foehn-high',
            category: 'foehn',
            level: 'demanding',
            value: foehn.metrics?.score ?? null,
            text: 'Mehrere konsistente Föhnindikatoren'
        });
        return;
    }
    if (foehn.level === 'elevated') {
        addReason(reasons, {
            code: 'foehn-elevated',
            category: 'foehn',
            level: null,
            value: foehn.metrics?.score ?? null,
            text: 'Föhnige Tendenz – einzelne Indikatoren'
        });
    }
}

const FOEHN_SAFETY_POLICY = Object.freeze({
    critical: 'foehn.level === critical'
});

export function assessSafety(hour, options = {}) {
    const comfortThresholds = options.comfortThresholds || buildComfortThresholds(options.limits || LIMITS);
    const comfortFilters = {
        wind: true,
        clouds: true,
        precip: true,
        ...(options.comfortFilters || {})
    };
    const metrics = deriveHourMetrics(hour);
    const dataQuality = safetyDataQuality(hour, metrics);
    const reasons = [];
    const blockers = [];
    const hardContext = evaluateHardBlockers(metrics, reasons, blockers);
    evaluateComfort(metrics, comfortThresholds, comfortFilters, reasons, hardContext);
    integrateFoehn(options.foehn, reasons, blockers);

    let level = 'relaxed';
    if (blockers.length > 0) {
        level = 'critical';
    } else if (dataQuality.criticalMissing.length > 0) {
        level = 'unknown';
        addReason(reasons, {
            code: 'critical-missing-data',
            category: 'dataQuality',
            level: 'unknown',
            text: `Keine belastbare Bewertung: ${dataQuality.criticalMissing.join(', ')}`
        });
    } else {
        for (const reason of reasons) {
            if (reason.level && SAFETY_LEVEL_RANK[reason.level] > SAFETY_LEVEL_RANK[level]) level = reason.level;
        }
    }

    const limitingCandidates = reasons
        .filter(reason => reason.level === level || (level === 'critical' && reason.hardBlocker))
        .slice(0, 2)
        .map(reason => ({ code: reason.code, text: reason.text, level: reason.level }));

    return {
        level,
        label: LEVEL_LABELS[level],
        reasons,
        blockers,
        limitingFactor: limitingCandidates[0] || null,
        limitingFactors: limitingCandidates,
        metrics,
        comfortThresholds,
        hardSafetyThresholds: HARD_SAFETY_THRESHOLDS,
        foehn: options.foehn || null,
        dataQuality
    };
}
