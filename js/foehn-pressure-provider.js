/**
 * Stündliche Referenzdrücke für das Föhnmodul.
 *
 * CIVIS liefert robuste aktuelle Südtiroler Stationsdaten, aber kein
 * dokumentiertes stündliches Bozen–Innsbruck-Prognosepaar. Deshalb werden
 * für beide Referenzpunkte konsistente ICON-MSL-Druckprognosen verwendet.
 * Das offizielle Föhndiagramm wird in der UI zusätzlich verlinkt.
 */

import { API_CONFIG } from './config.js';
import { FOEHN_LINKS, FOEHN_REFERENCE_POINTS } from './foehn-config.js';

function buildUrl(forecastDays) {
    const params = new URLSearchParams({
        latitude: `${FOEHN_REFERENCE_POINTS.bozen.lat},${FOEHN_REFERENCE_POINTS.innsbruck.lat}`,
        longitude: `${FOEHN_REFERENCE_POINTS.bozen.lon},${FOEHN_REFERENCE_POINTS.innsbruck.lon}`,
        hourly: 'pressure_msl',
        timezone: API_CONFIG.timezone,
        forecast_days: String(forecastDays),
        models: 'icon_seamless'
    });
    return `${API_CONFIG.baseUrl}?${params}`;
}

function parsePressureSeries(data) {
    const times = data?.hourly?.time;
    const values = data?.hourly?.pressure_msl;
    if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length) {
        throw new Error('invalid-pressure-response');
    }
    return new Map(times.map((time, index) => [
        time,
        Number.isFinite(values[index]) ? values[index] : null
    ]));
}

async function fetchPressurePair(options) {
    const response = await options.fetchImpl(buildUrl(options.forecastDays), {
        signal: options.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || data.length !== 2) {
        throw new Error('invalid-pressure-response');
    }
    return {
        bozen: parsePressureSeries(data[0]),
        innsbruck: parsePressureSeries(data[1])
    };
}

export async function fetchFoehnPressureSeries(options = {}) {
    const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
    const timeoutMs = options.timeoutMs || API_CONFIG.timeout;
    const forecastDays = options.forecastDays || 3;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const providerOptions = { fetchImpl, forecastDays, signal: controller.signal };
        const { bozen, innsbruck } = await fetchPressurePair(providerOptions);
        const times = [...bozen.keys()].filter(time => innsbruck.has(time));
        const series = times.map(time => {
            const bozenPressureMslHpa = bozen.get(time);
            const innsbruckPressureMslHpa = innsbruck.get(time);
            return {
                time,
                source: 'openMeteoIconPressureMsl',
                bozenPressureMslHpa,
                innsbruckPressureMslHpa,
                bozenMinusInnsbruckHpa: Number.isFinite(bozenPressureMslHpa) && Number.isFinite(innsbruckPressureMslHpa)
                    ? Math.round((bozenPressureMslHpa - innsbruckPressureMslHpa) * 10) / 10
                    : null
            };
        });
        if (!series.some(item => item.bozenMinusInnsbruckHpa !== null)) {
            throw new Error('missing-pressure-values');
        }
        return {
            status: 'available',
            source: 'openMeteoIconPressureMsl',
            definition: 'bozenPressureMslHpa - innsbruckPressureMslHpa',
            officialDiagramUrl: FOEHN_LINKS.officialDiagram,
            series
        };
    } catch (error) {
        return {
            status: 'unavailable',
            source: 'openMeteoIconPressureMsl',
            definition: 'bozenPressureMslHpa - innsbruckPressureMslHpa',
            officialDiagramUrl: FOEHN_LINKS.officialDiagram,
            reason: error?.name === 'AbortError' ? 'timeout' : 'provider-error',
            series: []
        };
    } finally {
        clearTimeout(timeoutId);
    }
}
