/**
 * Zentrale Zeiträume für v11-Aggregationen.
 *
 * 06–20 Uhr ist die sichtbare Pilotentagesansicht für Dashboard, Timeline,
 * Thermikfenster, Favoriten und Tageskonsens. Der Modellkonsens gewichtet
 * 10–17 Uhr stärker. Die 08–18-Uhr-Spanne bleibt ausschließlich für die
 * eindeutig gekennzeichnete v10-Kategoriediagnose erhalten.
 */

export const FORECAST_PERIODS = Object.freeze({
    pilotDay: Object.freeze({ start: 6, end: 20, label: '06–20 Uhr' }),
    consensusCore: Object.freeze({ start: 10, end: 17, label: '10–17 Uhr' }),
    legacyCategorySummary: Object.freeze({ start: 8, end: 18, label: '08–18 Uhr' })
});

export function localHourFromTimestamp(timestamp) {
    const match = typeof timestamp === 'string' ? timestamp.match(/T(\d{2}):/) : null;
    return match ? Number(match[1]) : null;
}

export function isHourInPeriod(hour, period = FORECAST_PERIODS.pilotDay) {
    return Number.isFinite(hour) && hour >= period.start && hour <= period.end;
}
