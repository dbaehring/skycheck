/**
 * Phase 2b: zeitliche Aggregation der unabhängigen Thermikbewertung.
 * Alle Grenzen bleiben auf volle Modellstunden beschränkt; es findet keine
 * Interpolation zu vermeintlich genaueren Start- oder Endzeiten statt.
 */

import { THERMAL_LEVEL_RANK, THERMAL_THRESHOLDS } from './thermal-config.js';
import { isHourInPeriod } from './forecast-periods.js';

const DAY_LABELS = Object.freeze({
    weak: 'Schwach',
    usable: 'Brauchbar',
    good: 'Gut',
    excellent: 'Sehr gut',
    unknown: 'Unklar'
});

function hourOf(timestamp) {
    const match = typeof timestamp === 'string' ? timestamp.match(/T(\d{2}):/) : null;
    return match ? Number(match[1]) : null;
}

function dayOf(timestamp) {
    return typeof timestamp === 'string' ? timestamp.split('T')[0] : null;
}

function peakLevel(assessments, indices) {
    return indices.reduce((best, index) => {
        const level = assessments[index]?.thermal?.level || 'unknown';
        return THERMAL_LEVEL_RANK[level] > THERMAL_LEVEL_RANK[best] ? level : best;
    }, 'weak');
}

export function findThermalWindows(hours, assessments, dayStr, minimumLevel = 'usable', predicate = null) {
    const windows = [];
    const minimumRank = THERMAL_LEVEL_RANK[minimumLevel];
    let current = null;
    let previousHour = null;

    for (let index = 0; index < (hours || []).length; index++) {
        const hour = hours[index];
        if (dayOf(hour?.time) !== dayStr) continue;
        const localHour = hourOf(hour.time);
        if (!isHourInPeriod(localHour)) continue;
        const thermal = assessments[index]?.thermal;
        const eligible = thermal && THERMAL_LEVEL_RANK[thermal.level] >= minimumRank &&
            (!predicate || predicate(thermal, assessments[index]));
        const contiguous = current && previousHour !== null && localHour === previousHour + 1;

        if (eligible) {
            if (!current || !contiguous) {
                if (current) windows.push(current);
                current = { start: localHour, end: localHour, indices: [index] };
            } else {
                current.end = localHour;
                current.indices.push(index);
            }
            previousHour = localHour;
        } else {
            if (current) windows.push(current);
            current = null;
            previousHour = null;
        }
    }

    if (current) windows.push(current);
    return windows.map(window => ({
        ...window,
        durationHours: window.indices.length,
        peakLevel: peakLevel(assessments, window.indices)
    }));
}

export function findBestThermalWindow(hours, assessments, dayStr) {
    const windows = findThermalWindows(hours, assessments, dayStr, 'good', thermal =>
        thermal.components?.thermalActivity?.precipitationPenalty > -18 &&
        thermal.components?.thermalActivity?.cloudPenalty > -20
    );
    if (windows.length === 0) return null;

    const ranked = windows.map(window => {
        const thermalValues = window.indices.map(index => assessments[index].thermal);
        const totalScore = thermalValues.reduce((sum, thermal) => sum + thermal.score, 0);
        const depths = thermalValues.map(thermal => thermal.metrics.usableThermalDepthM).filter(Number.isFinite);
        return {
            ...window,
            totalScore,
            averageDepthM: depths.length > 0 ? Math.round(depths.reduce((sum, value) => sum + value, 0) / depths.length) : null
        };
    }).sort((first, second) =>
        second.durationHours - first.durationHours ||
        second.totalScore - first.totalScore ||
        (second.averageDepthM || 0) - (first.averageDepthM || 0)
    );
    const best = ranked[0];
    const excellentHours = best.indices.filter(index => assessments[index].thermal.level === 'excellent').length;
    const reliableHeightHours = best.indices.filter(index => assessments[index].thermal.metrics.hasReliableHeightLimit).length;
    const weakestIndex = best.indices.reduce((weakest, index) =>
        assessments[index].thermal.score < assessments[weakest].thermal.score ? index : weakest
    );

    return {
        start: best.start,
        end: best.end,
        durationHours: best.durationHours,
        thermalLevel: excellentHours >= 2 && best.durationHours >= 3 && reliableHeightHours >= 2 ? 'excellent' : 'good',
        peakLevel: best.peakLevel,
        averageDepthM: best.averageDepthM,
        reliableHeightHours,
        safetyLevels: best.indices.map(index => ({
            time: hours[index].time,
            level: assessments[index].safety?.level || 'unknown'
        })),
        limitingFactor: assessments[weakestIndex].thermal.limitingFactor,
        indices: best.indices
    };
}

export function assessThermalDay(hours, assessments, dayStr) {
    const dayIndices = [];
    for (let index = 0; index < (hours || []).length; index++) {
        if (dayOf(hours[index]?.time) === dayStr && isHourInPeriod(hourOf(hours[index]?.time))) dayIndices.push(index);
    }
    const knownIndices = dayIndices.filter(index => assessments[index]?.thermal?.level !== 'unknown');
    const config = THERMAL_THRESHOLDS.aggregation;
    const usableWindows = findThermalWindows(hours, assessments, dayStr, 'usable');
    const goodWindows = findThermalWindows(hours, assessments, dayStr, 'good');
    const bestThermalWindow = findBestThermalWindow(hours, assessments, dayStr);

    if (knownIndices.length < config.minimumKnownHours) {
        return {
            level: 'unknown',
            label: DAY_LABELS.unknown,
            reasons: ['Zu wenige belastbar bewertbare Thermikstunden'],
            metrics: { knownHours: knownIndices.length },
            thermalWindows: usableWindows,
            bestThermalWindow,
            confidence: { overall: 'low', activity: 'low', height: 'low' }
        };
    }

    const goodHours = knownIndices.filter(index => THERMAL_LEVEL_RANK[assessments[index].thermal.level] >= THERMAL_LEVEL_RANK.good).length;
    const excellentHours = knownIndices.filter(index => assessments[index].thermal.level === 'excellent').length;
    const usableHours = knownIndices.filter(index => THERMAL_LEVEL_RANK[assessments[index].thermal.level] >= THERMAL_LEVEL_RANK.usable).length;
    const longestGoodHours = goodWindows.reduce((longest, window) => Math.max(longest, window.durationHours), 0);
    const averageGoodDepthM = bestThermalWindow?.averageDepthM ?? null;
    const reliableHeightHours = bestThermalWindow?.reliableHeightHours ?? 0;
    let level = 'weak';
    if (longestGoodHours >= config.excellentWindowHours &&
        excellentHours >= config.excellentHours &&
        averageGoodDepthM >= config.excellentAverageDepthM &&
        reliableHeightHours >= config.excellentHours) {
        level = 'excellent';
    } else if (longestGoodHours >= config.goodWindowHours || goodHours >= 4) {
        level = 'good';
    } else if (usableHours >= 2 || goodHours >= 1) {
        level = 'usable';
    }

    const confidenceFor = key => {
        const values = knownIndices.map(index => assessments[index].thermal.confidence[key]);
        return values.includes('low') ? 'low' : values.includes('medium') ? 'medium' : 'high';
    };
    const activityConfidence = confidenceFor('activity');
    const heightConfidence = confidenceFor('height');
    const confidence = {
        overall: activityConfidence === 'low'
            ? 'low'
            : activityConfidence === 'high' && heightConfidence === 'high'
                ? 'high'
                : 'medium',
        activity: activityConfidence,
        height: heightConfidence
    };
    const reasons = [
        `${goodHours} gute, davon ${excellentHours} sehr gute Stunden`,
        longestGoodHours > 0 ? `Längstes gutes Fenster ${longestGoodHours} Stunden` : 'Kein zusammenhängendes gutes Fenster'
    ];

    return {
        level,
        label: DAY_LABELS[level],
        reasons,
        metrics: {
            knownHours: knownIndices.length,
            usableHours,
            goodHours,
            excellentHours,
            longestGoodHours,
            averageGoodDepthM,
            reliableHeightHours
        },
        thermalWindows: usableWindows,
        bestThermalWindow,
        confidence
    };
}
