/**
 * Phase 5: reine View-Model- und Zeitfenster-Aggregation für das
 * Entscheidungs-Dashboard. Die meteorologischen Engines werden hier weder
 * erneut ausgeführt noch zu einem gemeinsamen Score verrechnet.
 */

import { assessThermalDay } from './thermal-aggregation.js';

export const DASHBOARD_LABELS = Object.freeze({
    safety: Object.freeze({
        relaxed: 'Entspannt',
        sporty: 'Sportlich',
        demanding: 'Anspruchsvoll',
        critical: 'Kritisch',
        unknown: 'Unbekannt'
    }),
    thermal: Object.freeze({
        weak: 'Schwach',
        usable: 'Brauchbar',
        good: 'Gut',
        excellent: 'Sehr gut',
        unknown: 'Unbekannt'
    }),
    foehn: Object.freeze({
        low: 'Niedrig',
        elevated: 'Erhöht',
        high: 'Hoch',
        critical: 'Kritisch',
        unknown: 'Unbekannt',
        notApplicable: 'Nicht anwendbar'
    }),
    confidence: Object.freeze({
        high: 'Hoch',
        medium: 'Mittel',
        low: 'Gering',
        unknown: 'Unbekannt'
    })
});

const SAFETY_RANK = Object.freeze({ unknown: 0, relaxed: 1, sporty: 2, demanding: 3, critical: 4 });
const THERMAL_RANK = Object.freeze({ unknown: 0, weak: 1, usable: 2, good: 3, excellent: 4 });
const FOEHN_RANK = Object.freeze({ notApplicable: 0, unknown: 0, low: 1, elevated: 2, high: 3, critical: 4 });
const CONFIDENCE_RANK = Object.freeze({ unknown: 0, low: 1, medium: 2, high: 3 });

function localHour(timestamp) {
    const match = typeof timestamp === 'string' ? timestamp.match(/T(\d{2}):/) : null;
    return match ? Number(match[1]) : null;
}

function formatTimeRange(start, end) {
    return `${String(start).padStart(2, '0')}:00–${String(end).padStart(2, '0')}:00`;
}

function worstKnown(items, getLevel, ranks, fallback = 'unknown') {
    const known = items.map(getLevel).filter(level => level && level !== 'unknown');
    if (known.length === 0) return fallback;
    return known.reduce((worst, level) => ranks[level] > ranks[worst] ? level : worst, known[0]);
}

function bestKnown(items, getLevel, ranks, fallback = 'unknown') {
    const known = items.map(getLevel).filter(level => level && level !== 'unknown');
    if (known.length === 0) return fallback;
    return known.reduce((best, level) => ranks[level] > ranks[best] ? level : best, known[0]);
}

function lowestKnown(items, getLevel, ranks, fallback = 'unknown') {
    const known = items.map(getLevel).filter(level => level && level !== 'unknown');
    if (known.length === 0) return fallback;
    return known.reduce((lowest, level) => ranks[level] < ranks[lowest] ? level : lowest, known[0]);
}

function confidenceForTime(hourlyConfidence, time) {
    return (hourlyConfidence || []).find(item => item.time === time) || null;
}

function foehnLevel(foehn) {
    if (foehn?.applicability === 'notApplicable') return 'notApplicable';
    return foehn?.level || 'unknown';
}

function isWithoutHardBlocker(assessment) {
    return (assessment?.hardBlockers?.length || assessment?.safety?.blockers?.length || 0) === 0;
}

function collectWindows(hours, assessments, dayStr, hourlyConfidence, mode) {
    const windows = [];
    let current = null;
    let previousHour = null;

    for (let index = 0; index < (hours || []).length; index++) {
        const hour = hours[index];
        if (!hour?.time?.startsWith(dayStr)) continue;
        const value = localHour(hour.time);
        if (value < 6 || value > 20) continue;
        const assessment = assessments[index];
        const safety = assessment?.safety?.level || 'unknown';
        const thermal = assessment?.thermal?.level || 'unknown';
        const foehn = foehnLevel(assessment?.foehn);
        const acceptedSafety = mode === 'thermal'
            ? safety === 'relaxed' || safety === 'sporty'
            : safety === 'relaxed';
        const acceptedThermal = mode === 'thermal'
            ? thermal === 'good' || thermal === 'excellent'
            : thermal === 'weak' || thermal === 'usable';
        const eligible = acceptedSafety && acceptedThermal &&
            foehn !== 'high' && foehn !== 'critical' && isWithoutHardBlocker(assessment);
        const contiguous = current && previousHour !== null && value === previousHour + 1;

        if (eligible) {
            if (!current || !contiguous) {
                if (current) windows.push(current);
                current = { start: value, end: value, indices: [index] };
            } else {
                current.end = value;
                current.indices.push(index);
            }
            previousHour = value;
        } else {
            if (current) windows.push(current);
            current = null;
            previousHour = null;
        }
    }
    if (current) windows.push(current);

    return windows.map(window => {
        const windowAssessments = window.indices.map(index => assessments[index]);
        const depths = windowAssessments
            .map(item => item.thermal?.metrics?.usableThermalDepthM)
            .filter(Number.isFinite);
        const confidences = window.indices.map(index =>
            confidenceForTime(hourlyConfidence, hours[index].time)?.level || 'unknown'
        );
        return {
            ...window,
            type: mode,
            durationHours: window.indices.length,
            safetyLevel: worstKnown(windowAssessments, item => item.safety?.level, SAFETY_RANK),
            thermalLevel: bestKnown(windowAssessments, item => item.thermal?.level, THERMAL_RANK),
            foehnLevel: worstKnown(windowAssessments, item => foehnLevel(item.foehn), FOEHN_RANK, 'notApplicable'),
            confidenceLevel: lowestKnown(confidences, level => level, CONFIDENCE_RANK),
            averageDepthM: depths.length
                ? Math.round(depths.reduce((sum, depth) => sum + depth, 0) / depths.length)
                : null
        };
    });
}

function compareWindows(first, second) {
    return second.durationHours - first.durationHours ||
        SAFETY_RANK[first.safetyLevel] - SAFETY_RANK[second.safetyLevel] ||
        THERMAL_RANK[second.thermalLevel] - THERMAL_RANK[first.thermalLevel] ||
        (second.averageDepthM || 0) - (first.averageDepthM || 0) ||
        CONFIDENCE_RANK[second.confidenceLevel] - CONFIDENCE_RANK[first.confidenceLevel] ||
        first.start - second.start;
}

export function findBestWeatherWindow(hours, assessments, dayStr, hourlyConfidence = []) {
    const thermalWindows = collectWindows(hours, assessments, dayStr, hourlyConfidence, 'thermal');
    const candidates = thermalWindows.length > 0
        ? thermalWindows
        : collectWindows(hours, assessments, dayStr, hourlyConfidence, 'quiet');
    if (candidates.length === 0) return null;
    return [...candidates].sort(compareWindows)[0];
}

function dataQualityText(assessment) {
    const missing = assessment?.safety?.dataQuality?.criticalMissing || assessment?.dataQuality?.criticalMissing || [];
    if (missing.length > 0) return `Fehlende Kerndaten: ${missing.join(', ')}`;
    if (assessment?.dataQuality?.stale) return 'Vorhersagedaten sind veraltet.';
    return 'Nicht genügend belastbare Modelldaten.';
}

function selectHints(dayAssessments, safetyLevel, foehn, confidence, thermalDay) {
    const hints = [];
    const blocker = dayAssessments.flatMap(item => item?.safety?.blockers || item?.hardBlockers || [])[0];
    const safetyReason = dayAssessments.find(item => item?.safety?.level === safetyLevel)?.safety?.limitingFactor;
    if (blocker?.text) hints.push({ tone: 'critical', text: blocker.text });
    if (foehn === 'critical' || foehn === 'high') {
        hints.push({ tone: 'critical', text: 'Markante Föhnindikatoren im Tagesverlauf.' });
    }
    if (safetyReason?.text && !hints.some(item => item.text === safetyReason.text)) {
        hints.push({ tone: safetyLevel === 'critical' ? 'critical' : 'caution', text: safetyReason.text });
    }
    if (confidence === 'low' || confidence === 'unknown') {
        hints.push({ tone: 'caution', text: 'Modelle liefern nur eine geringe oder unvollständige Übereinstimmung.' });
    }
    if (thermalDay?.reasons?.[0] && hints.length < 2) {
        hints.push({ tone: 'neutral', text: thermalDay.reasons[0] });
    }
    return hints.slice(0, 2);
}

export function buildDashboardDayView(hours, assessments, dayStr, dailyConfidence = null, hourlyConfidence = []) {
    const indices = [];
    for (let index = 0; index < (hours || []).length; index++) {
        const value = localHour(hours[index]?.time);
        if (hours[index]?.time?.startsWith(dayStr) && value >= 6 && value <= 20) indices.push(index);
    }
    const dayAssessments = indices.map(index => assessments[index]).filter(Boolean);
    const safetyLevel = worstKnown(dayAssessments, item => item.safety?.level, SAFETY_RANK);
    const thermalDay = assessThermalDay(hours, assessments, dayStr);
    const applicableFoehn = dayAssessments.filter(item => item.foehn?.applicability !== 'notApplicable');
    const foehn = applicableFoehn.length === 0
        ? 'notApplicable'
        : worstKnown(applicableFoehn, item => item.foehn?.level, FOEHN_RANK);
    const confidence = dailyConfidence?.level || 'unknown';
    const bestWindow = findBestWeatherWindow(hours, assessments, dayStr, hourlyConfidence);
    const hasThermalConflict = !bestWindow && dayAssessments.some(item =>
        (item.thermal?.level === 'good' || item.thermal?.level === 'excellent') &&
        (item.safety?.level === 'critical' || (item.hardBlockers?.length || 0) > 0)
    );

    return {
        date: dayStr,
        safety: { level: safetyLevel, label: DASHBOARD_LABELS.safety[safetyLevel] },
        thermal: { level: thermalDay.level, label: DASHBOARD_LABELS.thermal[thermalDay.level] },
        foehn: { level: foehn, label: DASHBOARD_LABELS.foehn[foehn] },
        confidence: { level: confidence, label: DASHBOARD_LABELS.confidence[confidence] },
        bestWindow: bestWindow ? {
            ...bestWindow,
            timeLabel: formatTimeRange(bestWindow.start, bestWindow.end),
            label: bestWindow.type === 'thermal' ? 'Interessantes Wetterfenster' : 'Ruhiges Wetterfenster',
            description: bestWindow.type === 'thermal'
                ? `${DASHBOARD_LABELS.safety[bestWindow.safetyLevel]} · Thermik ${DASHBOARD_LABELS.thermal[bestWindow.thermalLevel].toLowerCase()}`
                : 'Entspannte Bedingungen bei schwacher bis brauchbarer Thermik'
        } : null,
        hasThermalConflict,
        hints: selectHints(dayAssessments, safetyLevel, foehn, confidence, thermalDay),
        dataQualityReason: safetyLevel === 'unknown'
            ? dataQualityText(dayAssessments[0])
            : null,
        thermalDay
    };
}

function formatWind(level, fallbackLabel) {
    if (!level || !Number.isFinite(level.speedKmh)) return `${fallbackLabel}: n. v.`;
    const direction = Number.isFinite(level.directionDeg) ? ` · ${Math.round(level.directionDeg)}°` : '';
    const height = Number.isFinite(level.geopotentialHeightMslM)
        ? ` auf ${Math.round(level.geopotentialHeightMslM)} m MSL`
        : '';
    return `${fallbackLabel}: ${Math.round(level.speedKmh)} km/h${direction}${height}`;
}

export function buildDashboardHourView(hour, assessment, confidence = null) {
    const safety = assessment?.safety?.level || 'unknown';
    const thermal = assessment?.thermal?.level || 'unknown';
    const foehn = foehnLevel(assessment?.foehn);
    const consensus = confidence?.level || 'unknown';
    const levels = hour?.wind?.levels || [];
    const level850 = levels.find(level => level.pressureHpa === 850);
    const level800 = levels.find(level => level.pressureHpa === 800);
    const surface = hour?.surface || {};
    const thermalMetrics = assessment?.thermal?.metrics || {};
    const base = Number.isFinite(thermalMetrics.modelCloudBaseMslM)
        ? { value: thermalMetrics.modelCloudBaseMslM, source: 'Modellierte konvektive Basis' }
        : Number.isFinite(thermalMetrics.estimatedLclMslM)
            ? { value: thermalMetrics.estimatedLclMslM, source: 'Geschätztes LCL' }
            : null;
    const time = localHour(hour?.time);

    return {
        timeLabel: Number.isInteger(time) ? `${String(time).padStart(2, '0')}:00` : '—',
        safety: { level: safety, label: DASHBOARD_LABELS.safety[safety] },
        thermal: { level: thermal, label: DASHBOARD_LABELS.thermal[thermal] },
        foehn: { level: foehn, label: DASHBOARD_LABELS.foehn[foehn] },
        confidence: { level: consensus, label: DASHBOARD_LABELS.confidence[consensus] },
        wind: {
            surface: Number.isFinite(surface.windSpeedKmh)
                ? `Boden: ${Math.round(surface.windSpeedKmh)} km/h · Böen ${Number.isFinite(surface.gustsKmh) ? Math.round(surface.gustsKmh) : 'n. v.'} km/h`
                : 'Boden: n. v.',
            level1500: formatWind(level850, '1500-m-Niveau (850 hPa)'),
            level2000: formatWind(level800, '2000-m-Niveau (800 hPa)'),
            base: Number.isFinite(thermalMetrics.windAtThermalTopKmh)
                ? `An der Thermikobergrenze: ${Math.round(thermalMetrics.windAtThermalTopKmh)} km/h`
                : 'An der Thermikobergrenze: n. v.'
        },
        thermalSummary: {
            base: base ? `${base.source}: ${Math.round(base.value)} m MSL` : 'Basis: n. v.',
            depth: Number.isFinite(thermalMetrics.usableThermalDepthM)
                ? `Nutzbare Tiefe: ${Math.round(thermalMetrics.usableThermalDepthM)} m`
                : 'Nutzbare Tiefe: n. v.',
            radiation: Number.isFinite(thermalMetrics.shortwaveRadiationWm2)
                ? `Globalstrahlung: ${Math.round(thermalMetrics.shortwaveRadiationWm2)} W/m²`
                : 'Globalstrahlung: n. v.',
            stability: thermalMetrics.stability?.category
                ? `Schichtung: ${thermalMetrics.stability.category}`
                : 'Schichtung: n. v.'
        },
        limitingFactor: assessment?.safety?.limitingFactor?.text || 'Kein dominanter Belastungsfaktor.',
        dataQualityReason: safety === 'unknown' ? dataQualityText(assessment) : null
    };
}
