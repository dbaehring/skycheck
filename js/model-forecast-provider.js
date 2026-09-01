/**
 * Ausfalltoleranter Open-Meteo-Provider fuer den separaten Modellvergleich.
 * Pro Modell wird genau ein kleiner, modellangepasster Request ausgefuehrt.
 */

import { API_CONFIG } from './config.js';
import { isInAlpineRegion, isInIconD2Coverage, isInIconEUCoverage } from './utils.js';
import {
    FORECAST_CONFIDENCE_THRESHOLDS,
    MODEL_FORECAST_CONFIG
} from './forecast-confidence-config.js';
import { normalizeModelForecastResponse } from './model-forecast-adapter.js';
import { buildForecastConsensus } from './model-consensus.js';

const modelCache = new Map();

function locationKey(location) {
    return `${Number(location.lat).toFixed(3)},${Number(location.lon).toFixed(3)}`;
}

function cacheKey(model, location, forecastDays) {
    return `${model.id}:${locationKey(location)}:${forecastDays}`;
}

function modelCoversLocation(model, location) {
    if (model.coverage === 'iconD2') return isInIconD2Coverage(location.lat, location.lon);
    if (model.coverage === 'iconEu') return isInIconEUCoverage(location.lat, location.lon);
    if (model.coverage === 'alps') return isInAlpineRegion(location.lat, location.lon);
    return true;
}

function cachedResult(key, force) {
    if (force) return null;
    const cached = modelCache.get(key);
    if (!cached || cached.expiresAt <= Date.now()) {
        modelCache.delete(key);
        return null;
    }
    return { ...cached.result, fromCache: true };
}

async function fetchOneModel(model, location, options) {
    const key = cacheKey(model, location, options.forecastDays);
    const cached = cachedResult(key, options.force);
    if (cached) return cached;

    const params = new URLSearchParams({
        latitude: location.lat,
        longitude: location.lon,
        hourly: model.hourlyFields.join(','),
        wind_speed_unit: 'kmh',
        timezone: options.timezone,
        forecast_days: options.forecastDays,
        models: model.id
    });
    if (Number.isFinite(location.elevation)) params.set('elevation', location.elevation);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);
    let result;
    try {
        const response = await options.fetchImpl(`${API_CONFIG.baseUrl}?${params}`, {
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data?.error) throw new Error(data.reason || 'API-Fehler');
        const normalized = normalizeModelForecastResponse(model, data);
        if (normalized.comparableHourCount === 0) throw new Error('Keine vergleichbaren Felder verfügbar');
        result = { status: 'available', model: normalized, error: null, fromCache: false };
    } catch (error) {
        const message = error?.name === 'AbortError' ? 'Zeitüberschreitung' : error?.message || 'Unbekannter Fehler';
        result = { status: 'unavailable', model: null, error: message, fromCache: false };
    } finally {
        clearTimeout(timeoutId);
    }

    const ttl = result.status === 'available'
        ? FORECAST_CONFIDENCE_THRESHOLDS.cacheTtlMs
        : FORECAST_CONFIDENCE_THRESHOLDS.failedModelCacheTtlMs;
    modelCache.set(key, { result, expiresAt: Date.now() + ttl });
    return result;
}

export async function fetchModelForecastConsensus({
    location,
    primaryHours = [],
    primaryAssessments = [],
    forecastDays = 3,
    timezone = API_CONFIG.timezone,
    fetchImpl = (...args) => fetch(...args),
    force = false
}) {
    const applicableModels = MODEL_FORECAST_CONFIG.filter(model => modelCoversLocation(model, location));
    const startedAt = performance.now();
    const settled = await Promise.allSettled(applicableModels.map(model =>
        fetchOneModel(model, location, { forecastDays, timezone, fetchImpl, force })
    ));
    const results = settled.map((item, index) => item.status === 'fulfilled'
        ? item.value
        : {
            status: 'unavailable',
            model: null,
            error: item.reason?.message || 'Unbekannter Fehler',
            fromCache: false,
            modelId: applicableModels[index].id
        });
    const availableModels = results.filter(result => result.status === 'available').map(result => result.model);
    const assessmentSeries = primaryHours.map((hour, index) => ({
        time: hour.time,
        assessment: primaryAssessments[index] || null
    }));
    const consensus = buildForecastConsensus(availableModels, assessmentSeries);
    const models = applicableModels.map((model, index) => ({
        id: model.id,
        displayName: model.displayName,
        resolution: model.resolution,
        pressureLevels: [...model.pressureLevels],
        status: results[index]?.status || 'unavailable',
        error: results[index]?.error || null,
        fromCache: Boolean(results[index]?.fromCache),
        grid: results[index]?.model?.grid || null
    }));

    return {
        status: availableModels.length > 0 ? 'ready' : 'unavailable',
        locationKey: locationKey(location),
        loadedAt: new Date().toISOString(),
        hourly: consensus.hourly,
        daily: consensus.daily,
        models,
        performance: {
            requestCount: results.filter(result => !result.fromCache).length,
            cacheHits: results.filter(result => result.fromCache).length,
            durationMs: Math.round(performance.now() - startedAt)
        }
    };
}

export function clearModelForecastCache(location = null) {
    if (!location) {
        modelCache.clear();
        return;
    }
    const keyPart = `:${locationKey(location)}:`;
    for (const key of modelCache.keys()) {
        if (key.includes(keyPart)) modelCache.delete(key);
    }
}
