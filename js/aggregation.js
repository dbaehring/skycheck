import { FORECAST_PERIODS } from './forecast-periods.js';

/**
 * Reine v10-Zeit- und Tagesaggregation.
 *
 * Die unterschiedlichen Zeitfenster werden für Phase 0 ausdrücklich
 * dokumentiert und konserviert:
 * - Timeline, bestes Fenster und Tageskarte: 06–20 Uhr
 * - Kategorie-Tageswerte: 08–18 Uhr
 * - Favoriten-Schnellbewertung: 06–20 Uhr
 */

export const V10_TIME_WINDOWS = Object.freeze({
    timeline: { start: FORECAST_PERIODS.pilotDay.start, end: FORECAST_PERIODS.pilotDay.end },
    categorySummary: { start: FORECAST_PERIODS.legacyCategorySummary.start, end: FORECAST_PERIODS.legacyCategorySummary.end },
    favoriteSummary: { start: FORECAST_PERIODS.pilotDay.start, end: FORECAST_PERIODS.pilotDay.end }
});

export function findHourIndex(hours, dayStr, hour) {
    const timestamp = `${dayStr}T${hour.toString().padStart(2, '0')}:00`;
    return hours.findIndex(item => item.time === timestamp);
}

export function findBestWindowForHours(hours, assessments, dayStr, window = V10_TIME_WINDOWS.timeline) {
    const windows = [];
    let currentWindow = null;

    for (let hour = window.start; hour <= window.end; hour++) {
        const index = findHourIndex(hours, dayStr, hour);
        if (index === -1) continue;

        if (assessments[index]?.score === 3) {
            if (!currentWindow) currentWindow = { start: hour, end: hour, indices: [index] };
            else {
                currentWindow.end = hour;
                currentWindow.indices.push(index);
            }
        } else if (currentWindow) {
            windows.push(currentWindow);
            currentWindow = null;
        }
    }

    if (currentWindow) windows.push(currentWindow);
    if (windows.length === 0) return null;
    return windows.reduce((best, candidate) =>
        (candidate.end - candidate.start) > (best.end - best.start) ? candidate : best
    );
}

export function getDayTrafficLightFromAssessments(hours, assessments, dayStr) {
    const bestWindow = findBestWindowForHours(hours, assessments, dayStr);
    const greenDuration = bestWindow ? bestWindow.end - bestWindow.start + 1 : 0;
    let hasRedHour = false;

    for (let hour = V10_TIME_WINDOWS.timeline.start; hour <= V10_TIME_WINDOWS.timeline.end; hour++) {
        const index = findHourIndex(hours, dayStr, hour);
        if (index !== -1 && assessments[index]?.score === 1) {
            hasRedHour = true;
            break;
        }
    }

    if (greenDuration >= 3) return { status: 'go', label: 'GO' };
    if (greenDuration >= 1 || !hasRedHour) return { status: 'caution', label: 'VORSICHT' };
    return { status: 'nogo', label: 'NO-GO' };
}

export function summarizeFavoriteDay(hours, assessments, dayStr) {
    let worstScore = 3;
    for (let hour = V10_TIME_WINDOWS.favoriteSummary.start; hour <= V10_TIME_WINDOWS.favoriteSummary.end; hour++) {
        const index = findHourIndex(hours, dayStr, hour);
        if (index !== -1) worstScore = Math.min(worstScore, assessments[index]?.score ?? 2);
    }

    return {
        worstScore,
        bestWindow: findBestWindowForHours(hours, assessments, dayStr, V10_TIME_WINDOWS.favoriteSummary)
    };
}
