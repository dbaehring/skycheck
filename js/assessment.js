/**
 * Zentrales Stunden-Assessment auf Basis normalisierter Wetterwerte.
 *
 * Die bestehende 1/2/3-Ampel bleibt als Legacy-Ergebnis erhalten. Phase 2a
 * ergänzt daneben eigenständige Safety-/Komfort- und Thermik-/XC-Ergebnisse.
 * Beide neuen Engines bleiben voneinander und vom Legacy-Score unabhängig.
 */

import { LIMITS } from './config.js';
import { assessSafety } from './safety-engine.js';
import { assessThermal } from './thermal-engine.js';
import { buildThermalDayContexts } from './thermal-metrics.js';
import {
    deriveHourMetrics,
    getFogRiskFromValues
} from './weather-metrics.js';

export { deriveHourMetrics, getFogRiskFromValues, getPressureLevel } from './weather-metrics.js';

export const ALL_COMFORT_FILTERS = Object.freeze({
    wind: true,
    thermik: true,
    clouds: true,
    precip: true
});

export const HARD_BLOCKER_POLICY = Object.freeze([
    'Bestehende rote Wind-, Böen-, Höhenwind- und Gradientgrenzen',
    'Bestehende rote CAPE- und Lifted-Index-Grenzen',
    'Bestehende schwere Nebel-/Sicht- und tiefe-Wolken-Grenzen',
    'Bestehende rote Niederschlags- und Schauergrenzen'
]);

export function deepMergeLimits(target, source) {
    const result = { ...target };
    const blockedKeys = ['__proto__', 'constructor', 'prototype'];
    if (!source || typeof source !== 'object') return result;

    for (const key of Object.keys(source)) {
        if (blockedKeys.includes(key)) continue;
        const value = source[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = deepMergeLimits(target?.[key] || {}, value);
        } else if (value !== undefined && value !== null) {
            result[key] = value;
        }
    }
    return result;
}

export function resolveEffectiveLimits(customLimits = null, expertMode = false) {
    return expertMode && customLimits ? deepMergeLimits(LIMITS, customLimits) : LIMITS;
}

function compareHigh(value, thresholds) {
    if (value === null) return null;
    if (value > thresholds.yellow) return 1;
    if (value > thresholds.green) return 2;
    return 3;
}

function deviation(value, green, yellow) {
    if (value === null || yellow === green) return 0;
    if (value > yellow) return ((value - yellow) / yellow) * 100 + 100;
    if (value > green) return ((value - green) / (yellow - green)) * 100;
    return 0;
}

function addReason(reasons, condition, reason) {
    if (condition) reasons.push(reason);
}

function evaluateWind(metrics, limits, reasons, hardBlockers) {
    const checks = [
        ['surface-wind', metrics.ws, limits.wind.surface, '💨 Bodenwind'],
        ['gusts', metrics.wg, limits.wind.gusts, '💨 Böen'],
        ['gust-spread', metrics.gustSpread, limits.wind.gustSpread, '💨 Böigkeit'],
        ['wind-900', metrics.w900, limits.wind.w900, '🌬️ Wind 1000m'],
        ['wind-850', metrics.w850, limits.wind.w850, '🌬️ Wind 1500m'],
        ['wind-800', metrics.w800, limits.wind.w800, '🌬️ Wind 2000m'],
        ['wind-700', metrics.w700, limits.wind.w700, '🌬️ Wind 3000m'],
        ['gradient-1500', metrics.gradient1500, limits.wind.gradient, '📊 Gradient'],
        ['gradient-3000', metrics.gradient3000, limits.wind.gradient3000, '📊 Gradient 3000m']
    ];
    const scores = [];

    for (const [code, value, threshold, label] of checks) {
        const score = compareHigh(value, threshold);
        if (score === null) continue;
        scores.push(score);
        if (score === 1) {
            hardBlockers.push({ category: 'wind', code, value, threshold: threshold.yellow });
            reasons.push({ category: 'wind', level: 'red', text: `${label} kritisch (${Math.round(value)} km/h)`, deviation: deviation(value, threshold.green, threshold.yellow), hardBlocker: true });
        } else if (score === 2) {
            reasons.push({ category: 'wind', level: 'yellow', text: `${label} erhöht (${Math.round(value)} km/h)`, deviation: deviation(value, threshold.green, threshold.yellow), hardBlocker: false });
        }
    }

    if (metrics.gustFactor > limits.wind.gustFactor.yellow && metrics.wg > limits.wind.gustFactorMinWind.yellow) {
        hardBlockers.push({ category: 'wind', code: 'gust-factor', value: metrics.gustFactor, threshold: limits.wind.gustFactor.yellow });
        reasons.push({ category: 'wind', level: 'red', text: `💨 Böenfaktor kritisch (${metrics.gustFactor.toFixed(1)}x)`, deviation: 120, hardBlocker: true });
        scores.push(1);
    } else if (metrics.gustFactor > limits.wind.gustFactor.green && metrics.wg > limits.wind.gustFactorMinWind.green) {
        reasons.push({ category: 'wind', level: 'yellow', text: `💨 Böenfaktor erhöht (${metrics.gustFactor.toFixed(1)}x)`, deviation: 60, hardBlocker: false });
        scores.push(2);
    }

    const required = [metrics.ws, metrics.wg, metrics.w900, metrics.w850, metrics.w800, metrics.w700];
    return required.some(value => value === null) ? null : Math.min(...scores, 3);
}

function evaluateThermik(metrics, limits, reasons, hardBlockers) {
    if (metrics.cape !== null) {
        if (metrics.cape > limits.cape.yellow) {
            hardBlockers.push({ category: 'thermik', code: 'cape', value: metrics.cape, threshold: limits.cape.yellow });
            reasons.push({ category: 'thermik', level: 'red', text: `⚡ CAPE kritisch (${Math.round(metrics.cape)} J/kg) – Gewittergefahr`, deviation: deviation(metrics.cape, limits.cape.green, limits.cape.yellow), hardBlocker: true });
        } else if (metrics.cape > limits.cape.green) {
            reasons.push({ category: 'thermik', level: 'yellow', text: `🌤️ CAPE erhöht (${Math.round(metrics.cape)} J/kg)`, deviation: deviation(metrics.cape, limits.cape.green, limits.cape.yellow), hardBlocker: false });
        }
    }

    if (metrics.liftedIndex !== null) {
        if (metrics.liftedIndex < limits.liftedIndex.yellow) {
            hardBlockers.push({ category: 'thermik', code: 'lifted-index', value: metrics.liftedIndex, threshold: limits.liftedIndex.yellow });
            reasons.push({ category: 'thermik', level: 'red', text: `⚡ Lifted Index ${metrics.liftedIndex.toFixed(1)} – stark labil`, deviation: 120, hardBlocker: true });
        } else if (metrics.liftedIndex < limits.liftedIndex.green) {
            reasons.push({ category: 'thermik', level: 'yellow', text: `⚡ Lifted Index ${metrics.liftedIndex.toFixed(1)} – labil`, deviation: 50, hardBlocker: false });
        }
    }

    addReason(reasons, metrics.spread !== null && metrics.spread > limits.spread.max, {
        category: 'thermik', level: 'yellow', text: `💧 Sehr trockene Luft (Spread ${metrics.spread?.toFixed(1)}°C) – schwache Thermik`, deviation: 30, hardBlocker: false
    });

    if (metrics.cape === null || metrics.liftedIndex === null || metrics.spread === null) return null;
    if (metrics.cape > limits.cape.yellow || metrics.liftedIndex < limits.liftedIndex.yellow) return 1;
    if (metrics.cape > limits.cape.green || metrics.liftedIndex < limits.liftedIndex.green || metrics.spread > limits.spread.max) return 2;
    return 3;
}

function evaluateClouds(metrics, limits, reasons, hardBlockers) {
    const fogRisk = getFogRiskFromValues(metrics.spread, metrics.ws, metrics.visibility, limits);

    if (metrics.cloudLow !== null) {
        if (metrics.cloudLow > limits.clouds.low.yellow) {
            hardBlockers.push({ category: 'clouds', code: 'low-clouds', value: metrics.cloudLow, threshold: limits.clouds.low.yellow });
            reasons.push({ category: 'clouds', level: 'red', text: `☁️ Tiefe Bewölkung ${Math.round(metrics.cloudLow)}%`, deviation: deviation(metrics.cloudLow, limits.clouds.low.green, limits.clouds.low.yellow), hardBlocker: true });
        } else if (metrics.cloudLow > limits.clouds.low.green) {
            reasons.push({ category: 'clouds', level: 'yellow', text: `☁️ Tiefe Bewölkung ${Math.round(metrics.cloudLow)}%`, deviation: deviation(metrics.cloudLow, limits.clouds.low.green, limits.clouds.low.yellow), hardBlocker: false });
        }
    }

    if (fogRisk === 'severe') {
        hardBlockers.push({ category: 'clouds', code: 'severe-fog', value: metrics.visibility, threshold: limits.fog.visibilitySevere });
        reasons.push({ category: 'clouds', level: 'red', text: metrics.visibility < limits.fog.visibilitySevere ? `🌫️ Kritische Sicht (${(metrics.visibility / 1000).toFixed(1)} km)` : `🌫️ Hohe Nebelgefahr – Spread ${metrics.spread.toFixed(1)}°C`, deviation: 150, hardBlocker: true });
    } else if (fogRisk === 'likely' || fogRisk === 'possible') {
        reasons.push({ category: 'clouds', level: 'yellow', text: fogRisk === 'likely' ? `🌁 Nebel wahrscheinlich – Spread ${metrics.spread.toFixed(1)}°C` : '🌁 Nebelrisiko oder eingeschränkte Sicht möglich', deviation: 60, hardBlocker: false });
    }

    if (metrics.cloudTotal !== null && metrics.cloudTotal > limits.clouds.total.yellow) {
        reasons.push({ category: 'clouds', level: 'yellow', text: `☁️ Starke Bewölkung ${Math.round(metrics.cloudTotal)}%`, deviation: deviation(metrics.cloudTotal, limits.clouds.total.green, limits.clouds.total.yellow), hardBlocker: false });
    }

    if ([metrics.cloudLow, metrics.cloudTotal, metrics.visibility].some(value => value === null) || fogRisk === 'unknown') return null;
    if (metrics.cloudLow > limits.clouds.low.yellow || fogRisk === 'severe') return 1;
    if (metrics.cloudTotal > limits.clouds.total.yellow || metrics.cloudLow > limits.clouds.low.green || metrics.visibility < limits.visibility.green || fogRisk === 'likely' || fogRisk === 'possible') return 2;
    return 3;
}

function evaluatePrecip(metrics, limits, reasons, hardBlockers) {
    if (metrics.precipitation !== null) {
        if (metrics.precipitation > limits.precip.yellow) {
            hardBlockers.push({ category: 'precip', code: 'precipitation', value: metrics.precipitation, threshold: limits.precip.yellow });
            reasons.push({ category: 'precip', level: 'red', text: `🌧️ Niederschlag ${metrics.precipitation.toFixed(1)} mm`, deviation: deviation(metrics.precipitation, limits.precip.green, limits.precip.yellow), hardBlocker: true });
        } else if (metrics.precipitation > limits.precip.green) {
            reasons.push({ category: 'precip', level: 'yellow', text: '🌧️ Leichter Niederschlag möglich', deviation: deviation(metrics.precipitation, limits.precip.green, limits.precip.yellow), hardBlocker: false });
        }
    }

    if (metrics.showers !== null) {
        if (metrics.showers > limits.showers.yellow) {
            hardBlockers.push({ category: 'precip', code: 'showers', value: metrics.showers, threshold: limits.showers.yellow });
            reasons.push({ category: 'precip', level: 'red', text: `⛈️ Schauer erwartet (${metrics.showers.toFixed(1)} mm)`, deviation: deviation(metrics.showers, limits.showers.green, limits.showers.yellow), hardBlocker: true });
        } else if (metrics.showers > limits.showers.green) {
            reasons.push({ category: 'precip', level: 'yellow', text: '🌦️ Lokale Schauer möglich', deviation: deviation(metrics.showers, limits.showers.green, limits.showers.yellow), hardBlocker: false });
        }
    }

    if (metrics.precipitationProbability !== null && metrics.precipitationProbability > limits.precipProb.yellow) {
        reasons.push({ category: 'precip', level: 'yellow', text: `🌧️ Regenwahrscheinlichkeit ${Math.round(metrics.precipitationProbability)}%`, deviation: metrics.precipitationProbability - limits.precipProb.yellow, hardBlocker: false });
    }

    // Bestehendes Detailverhalten: sehr hohe CAPE färbt auch Niederschlag rot.
    const capeCritical = metrics.cape !== null && metrics.cape > limits.cape.yellow;
    if ([metrics.precipitation, metrics.precipitationProbability, metrics.showers].some(value => value === null)) return null;
    if (metrics.precipitation > limits.precip.yellow || metrics.showers > limits.showers.yellow || capeCritical) return 1;
    if (metrics.precipitation > limits.precip.green || metrics.precipitationProbability > limits.precipProb.yellow || metrics.showers > limits.showers.green) return 2;
    return 3;
}

export function assessNormalizedHour(hour, options = {}) {
    const limits = options.limits || LIMITS;
    const comfortFilters = { ...ALL_COMFORT_FILTERS, ...(options.comfortFilters || {}) };
    const metrics = deriveHourMetrics(hour);
    const safety = assessSafety(hour, {
        limits,
        comfortFilters
    });
    const thermal = assessThermal(hour, { context: options.thermalContext });
    const reasons = [];
    const hardBlockers = [];

    const categories = {
        wind: evaluateWind(metrics, limits, reasons, hardBlockers),
        thermik: evaluateThermik(metrics, limits, reasons, hardBlockers),
        clouds: evaluateClouds(metrics, limits, reasons, hardBlockers),
        precip: evaluatePrecip(metrics, limits, reasons, hardBlockers)
    };

    const filteredReasons = reasons.filter(reason => reason.hardBlocker || comfortFilters[reason.category]);
    filteredReasons.sort((a, b) => {
        if (a.level === 'red' && b.level !== 'red') return -1;
        if (a.level !== 'red' && b.level === 'red') return 1;
        return b.deviation - a.deviation;
    });

    let score;
    if (hardBlockers.length > 0) {
        score = 1;
    } else {
        const activeScores = Object.entries(categories)
            .filter(([category]) => comfortFilters[category])
            .map(([, categoryScore]) => categoryScore);
        const containsUnknown = activeScores.some(categoryScore => categoryScore === null);
        const knownScores = activeScores.filter(categoryScore => categoryScore !== null);
        score = knownScores.length > 0 ? Math.min(...knownScores) : 3;
        if (containsUnknown || hour.dataQuality?.level === 'insufficient' || hour.dataQuality?.stale) {
            score = Math.min(score, 2);
        }
    }

    if (hour.dataQuality?.level !== 'good') {
        filteredReasons.push({
            category: 'dataQuality',
            level: 'yellow',
            text: `⚠️ Wetterdaten ${hour.dataQuality?.level === 'insufficient' ? 'unzureichend' : 'unvollständig'}`,
            deviation: 0,
            hardBlocker: false
        });
    }

    return {
        score,
        status: score === 1 ? 'nogo' : score === 2 ? 'caution' : 'go',
        categories,
        hardBlockers,
        comfortFilters,
        effectiveLimits: limits,
        metrics,
        reasons: filteredReasons,
        dataQuality: safety.dataQuality,
        safety,
        thermal
    };
}

export function assessNormalizedHours(hours, options = {}) {
    const contexts = buildThermalDayContexts(hours);
    return (hours || []).map(hour => {
        const day = typeof hour?.time === 'string' ? hour.time.split('T')[0] : null;
        return assessNormalizedHour(hour, {
            ...options,
            thermalContext: contexts.get(day) || {}
        });
    });
}
