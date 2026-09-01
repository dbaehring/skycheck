/**
 * SkyCheck - Wetter-Modul
 * API-Calls und Wetterdaten-Verarbeitung
 * v9 - Mit Datenvalidierung
 */

import { state } from './state.js';
import { BEGINNER_LIMITS, API_CONFIG, UI_CONFIG, METEO_CONSTANTS } from './config.js';
import { isInIconD2Coverage, isInIconEUCoverage, getGustFactor, escapeHtml, haversineDistance, getWindDir } from './utils.js';
import {
    OPEN_METEO_DAILY_FIELDS,
    OPEN_METEO_MAIN_HOURLY_FIELDS,
    OPEN_METEO_PRESSURE_HOURLY_FIELDS,
    normalizeOpenMeteoHourly
} from './open-meteo-adapter.js';
import {
    assessNormalizedHour,
    assessNormalizedHours,
    deriveHourMetrics,
    getFogRiskFromValues,
    resolveEffectiveLimits
} from './assessment.js';
import { findBestWindowForHours } from './aggregation.js';
import { assessThermalDay } from './thermal-aggregation.js';
import { isFoehnRegionApplicable } from './foehn-engine.js';
import { fetchFoehnPressureSeries } from './foehn-pressure-provider.js';
import { clearModelForecastCache } from './model-forecast-provider.js';

/**
 * Gibt die effektiven Limits zurück (Custom wenn gesetzt, sonst Default)
 * @returns {Object} Limits-Objekt
 */
export function getEffectiveLimits() {
    return resolveEffectiveLimits(state.customLimits, state.expertMode);
}

/**
 * Validiert Wetterdaten und behandelt fehlende Werte
 * @param {*} value - Rohwert von der API
 * @param {*} fallback - Fallback-Wert (Standard: null)
 * @returns {*} Validierter Wert oder Fallback wenn ungültig
 */
export function validateValue(value, fallback = null) {
    if (value === null || value === undefined || value === '' ||
        (typeof value === 'number' && isNaN(value))) {
        return fallback;
    }
    return value;
}

/**
 * Extrahiert Wind-Daten aus einem normalisierten Stundenwert.
 * Zentrale Funktion um Code-Duplikation zu vermeiden
 * @param {Object} hour - Normalisierter Stundenwert
 * @returns {Object} Wind-Daten mit allen relevanten Werten
 */
export function extractWindData(hour) {
    const metrics = deriveHourMetrics(hour);
    const directionFor = pressureHpa => hour?.wind?.levels?.find(level => level.pressureHpa === pressureHpa)?.directionDeg ?? null;
    return {
        ws: metrics.ws,
        wg: metrics.wg,
        w900: metrics.w900,
        w850: metrics.w850,
        w800: metrics.w800,
        w700: metrics.w700,
        wd10m: hour?.surface?.windDirectionDeg ?? null,
        wd900: directionFor(900),
        wd850: directionFor(850),
        wd800: directionFor(800),
        wd700: directionFor(700),
        grad: metrics.gradient1500,
        grad3000: metrics.gradient3000,
        gustSpread: metrics.gustSpread
    };
}

export function rebuildHourlyAssessments() {
    const limits = getEffectiveLimits();
    state.hourlyAssessments = assessNormalizedHours(state.hourlyWeather, {
        limits,
        comfortFilters: state.paramFilter,
        foehnPressureSeries: state.foehnPressure?.series || []
    });
    return state.hourlyAssessments;
}

export function getHourAssessment(index) {
    return state.hourlyAssessments[index] || null;
}

// Callback für UI-Updates (wird von main.js gesetzt)
let onWeatherLoaded = null;

export function setWeatherCallback(callback) {
    onWeatherLoaded = callback;
}

/**
 * Haupt-Funktion: Wetterdaten abrufen
 */
export async function fetchWeatherData() {
    const { lat, lon } = state.currentLocation;
    document.getElementById('initialState').style.display = 'none';
    document.getElementById('loading').classList.add('visible');
    document.getElementById('resultsContainer').style.display = 'none';

    // Modell-Priorität: icon_seamless nutzt automatisch ICON-D2 > ICON-EU > ICON-Global
    const inD2 = isInIconD2Coverage(lat, lon);
    const inEU = isInIconEUCoverage(lat, lon);

    let modelChoice, modelDisplayName;
    if (inEU) {
        // Europa: icon_seamless wählt automatisch das beste ICON-Modell
        // (ICON-D2 für Mitteleuropa, ICON-EU für Rest-Europa)
        modelChoice = 'icon_seamless';
        modelDisplayName = inD2 ? 'ICON-D2' : 'ICON-EU';
    } else {
        // Global: best_match wählt das beste verfügbare Modell
        modelChoice = 'best_match';
        modelDisplayName = 'ECMWF/GFS';
    }
    const timezone = inEU ? 'Europe/Berlin' : 'auto';
    state.foehnPressure = null;

    try {
        // Haupt-Wetterdaten (Wind, Thermik-Indikatoren, Wolken, Niederschlag)
        const params = new URLSearchParams({
            latitude: lat,
            longitude: lon,
            hourly: OPEN_METEO_MAIN_HOURLY_FIELDS.join(','),
            daily: OPEN_METEO_DAILY_FIELDS.join(','),
            wind_speed_unit: 'kmh',
            timezone: timezone,
            forecast_days: 3,
            models: modelChoice
        });

        // Höhenwinde auf verschiedenen Druckniveaus
        const pressureParams = new URLSearchParams({
            latitude: lat,
            longitude: lon,
            hourly: OPEN_METEO_PRESSURE_HOURLY_FIELDS.join(','),
            wind_speed_unit: 'kmh',
            timezone: timezone,
            forecast_days: 3,
            models: modelChoice
        });

        // API-Timeout (konfigurierbar via API_CONFIG)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);

        let d1, d2 = null;
        let mainResponse = null, pressureResponse = null;
        try {
            // Promise.allSettled für graceful degradation:
            // Hauptdaten sind kritisch, Höhenwinde sind optional
            const [mainResult, pressureResult] = await Promise.allSettled([
                fetch(API_CONFIG.baseUrl + '?' + params, { signal: controller.signal }),
                fetch(API_CONFIG.baseUrl + '?' + pressureParams, { signal: controller.signal })
            ]);
            clearTimeout(timeoutId);

            // Hauptdaten MÜSSEN erfolgreich sein
            if (mainResult.status === 'rejected') {
                throw mainResult.reason;
            }
            mainResponse = mainResult.value;
            if (!mainResponse.ok) {
                throw new Error(`Wetter-API HTTP ${mainResponse.status}`);
            }
            d1 = await mainResponse.json();

            // Höhenwinde sind optional - App funktioniert auch ohne
            if (pressureResult.status === 'fulfilled') {
                try {
                    pressureResponse = pressureResult.value;
                    if (!pressureResponse.ok) {
                        throw new Error(`Höhenwind-API HTTP ${pressureResponse.status}`);
                    }
                    d2 = await pressureResponse.json();
                } catch (e) {
                    console.warn('Höhenwinde-Daten konnten nicht geparst werden:', e);
                }
            } else {
                console.warn('Höhenwinde-Fetch fehlgeschlagen:', pressureResult.reason);
            }
            // Der zusätzliche Referenzdruckabruf folgt bewusst auf die zwei
            // bestehenden Requests, um das Wetter-API nicht mit drei
            // gleichzeitigen Abfragen zu belasten.
            state.foehnPressure = isFoehnRegionApplicable(state.currentLocation)
                ? await fetchFoehnPressureSeries({ forecastDays: 3 })
                : { status: 'notApplicable', series: [] };
            if (state.foehnPressure.status === 'unavailable') {
                console.warn('Föhn-Druckgradient nicht verfügbar; Bewertung nutzt nur das Höhenwindprofil.');
            }
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                throw new Error('Zeitüberschreitung - Server antwortet nicht');
            }
            throw fetchError;
        }

        // Prüfe auf API-Fehler (nur Hauptdaten kritisch)
        if (d1.error) {
            throw new Error(d1.reason || 'API-Fehler');
        }

        // Strukturelle Validierung der API-Response
        if (!d1.hourly || !Array.isArray(d1.hourly.time) || d1.hourly.time.length === 0) {
            throw new Error('Ungültige API-Antwort: Stündliche Daten fehlen');
        }

        if (!d2?.hourly) {
            // Höhenwinde nicht verfügbar - Warnung in Konsole
            console.warn('⚠️ Höhenwinde nicht verfügbar - Gradient-Bewertung eingeschränkt');
        }

        const stale = mainResponse?.headers?.get('sw-cache-stale') === 'true' ||
            pressureResponse?.headers?.get('sw-cache-stale') === 'true';
        state.hourlyWeather = normalizeOpenMeteoHourly(d1.hourly, d2?.hourly, {
            location: state.currentLocation,
            stale
        });
        rebuildHourlyAssessments();
        state.dailyData = d1.daily;
        state.lastUpdate = new Date();

        // Update UI
        document.getElementById('updateTime').textContent =
            state.lastUpdate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';

        // Modell-Anzeige dynamisch aktualisieren
        const modelNameEl = document.getElementById('modelName');
        const modelWarningEl = document.getElementById('modelWarning');
        modelNameEl.textContent = modelDisplayName;

        // Warnung/Info je nach Region
        if (!inEU) {
            // Außerhalb Europa: Warnung
            modelWarningEl.textContent = '⚠️ Außerhalb Europa - globales Modell (weniger genau für lokale Bedingungen)';
            modelWarningEl.style.display = 'block';
            modelWarningEl.style.borderColor = '';
            modelWarningEl.style.background = '';
            modelWarningEl.style.color = '';
        } else if (!inD2) {
            // Europa aber nicht Mitteleuropa: Info
            modelWarningEl.textContent = 'ℹ️ ICON-EU Modell (7km Auflösung)';
            modelWarningEl.style.display = 'block';
            modelWarningEl.style.borderColor = 'var(--accent)';
            modelWarningEl.style.background = 'var(--accent-glow)';
            modelWarningEl.style.color = 'var(--accent)';
        } else {
            // Mitteleuropa: Beste Qualität, keine Warnung
            modelWarningEl.style.display = 'none';
        }

        // UI callback aufrufen
        if (onWeatherLoaded) {
            onWeatherLoaded();
        }

        document.getElementById('loading').classList.remove('visible');
        document.getElementById('resultsContainer').style.display = 'flex';
        document.getElementById('resultsContainer').style.flexDirection = 'column';
        document.getElementById('resultsContainer').style.gap = '1rem';
        document.getElementById('locationName').textContent = state.currentLocation.name;
        document.getElementById('locationDetails').textContent =
            state.currentLocation.lat.toFixed(4) + '°N, ' + state.currentLocation.lon.toFixed(4) + '°E — ' +
            Math.round(state.currentLocation.elevation) + 'm ü.M.';
        document.getElementById('stationElevation').textContent = Math.round(state.currentLocation.elevation) + ' m';

        // FIX: Leaflet-Karte nach Layout-Änderung aktualisieren (verhindert graue Flächen)
        if (state.map) {
            setTimeout(() => state.map.invalidateSize(), UI_CONFIG.mapInvalidateDelay);
        }

    } catch(e) {
        console.error(e);
        document.getElementById('loading').classList.remove('visible');

        // Differenzierte Fehlermeldungen
        let errorIcon = '⚠️';
        let errorTitle = 'Fehler beim Laden';
        let errorDetail = escapeHtml(e.message);
        let errorHint = 'Bitte erneut versuchen oder anderen Standort wählen.';

        if (!navigator.onLine) {
            errorIcon = '📡';
            errorTitle = 'Keine Internetverbindung';
            errorDetail = 'Du bist offline.';
            errorHint = 'Prüfe deine Verbindung und versuche es erneut.';
        } else if (e.message.includes('Zeitüberschreitung') || e.name === 'AbortError') {
            errorIcon = '⏱️';
            errorTitle = 'Server antwortet nicht';
            errorDetail = 'Die Wetter-API ist momentan überlastet.';
            errorHint = 'Warte kurz und versuche es erneut.';
        } else if (e.message.includes('429') || e.message.includes('rate limit')) {
            errorIcon = '🚦';
            errorTitle = 'API-Limit erreicht';
            errorDetail = 'Zu viele Anfragen in kurzer Zeit.';
            errorHint = 'Bitte warte einige Minuten.';
        } else if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
            errorIcon = '🌐';
            errorTitle = 'Netzwerkfehler';
            errorDetail = 'Verbindung zum Wetterdienst fehlgeschlagen.';
            errorHint = 'Prüfe deine Internetverbindung.';
        }

        const initialState = document.getElementById('initialState');
        initialState.style.display = 'block';
        initialState.innerHTML = `
            <div class="initial-state-icon">${errorIcon}</div>
            <h3>${errorTitle}</h3>
            <p style="color: var(--red);">${errorDetail}</p>
            <p style="margin-top: 0.5rem;">${errorHint}</p>
        `;
        // Nach Timeout zurücksetzen
        setTimeout(() => {
            initialState.innerHTML = `
                <div class="initial-state-icon">🗺️</div>
                <h3>Wähle einen Standort</h3>
                <p>Klicke auf die Karte oder nutze GPS.</p>
            `;
        }, UI_CONFIG.errorResetDelay);
    }
}

/**
 * Daten neu laden
 */
export async function refreshData() {
    if (!state.currentLocation.lat) return;
    const btn = document.getElementById('refreshBtn');
    if (!btn) return;
    btn.classList.add('spinning');
    btn.disabled = true;
    clearModelForecastCache(state.currentLocation);
    await fetchWeatherData();
    btn.classList.remove('spinning');
    btn.disabled = false;
}

/**
 * Intelligente Nebel-Risiko-Erkennung
 * Kombiniert Spread, Wind und Sichtweite für zuverlässigere Vorhersage
 * @returns {'severe'|'likely'|'possible'|'unlikely'} Nebel-Risiko-Level
 */
export function getFogRisk(spread, windSpeed, visibility) {
    return getFogRiskFromValues(spread, windSpeed, visibility, getEffectiveLimits());
}

/**
 * Gesamt-Score für eine Stunde berechnen
 * Kombiniert Wind, Thermik, Wolken und Niederschlag
 * @param {number} i - Index in state.hourlyWeather
 * @returns {1|2|3} Score: 1=nogo (rot), 2=caution (gelb), 3=go (grün)
 */
export function getHourScore(i) {
    return getHourAssessment(i)?.score ?? 2;
}

/**
 * Zentrale Scoring-Funktion für beliebige hourly-Daten.
 * Wird von getHourScore() (Hauptansicht) und fetchQuickWeather() (Favoriten) genutzt.
 * @param {Object} h - Hourly-Daten-Objekt von der API
 * @param {number} i - Stunden-Index
 * @param {Object} [filter] - Parameter-Filter (default: alle aktiv)
 * @returns {number} Score: 3=GO, 2=VORSICHT, 1=NO-GO
 */
export function scoreHourFromData(hours, i = 0, filter = null) {
    const hour = Array.isArray(hours) ? hours[i] : hours;
    if (!hour) return 2;
    return assessNormalizedHour(hour, {
        limits: getEffectiveLimits(),
        comfortFilters: filter || state.paramFilter
    }).score;
}

/**
 * Wolkenbasis berechnen aus Spread × Faktor + Stationshöhe
 * Faustformel: Pro 1°C Spread steigt die Wolkenbasis um ~125m
 * @param {number} temp - Temperatur in °C
 * @param {number} dewpoint - Taupunkt in °C
 * @param {number} elevation - Stationshöhe in m
 * @returns {number} Geschätzte Wolkenbasis in m ü.M.
 */
export function calculateCloudBase(temp, dewpoint, elevation) {
    const spread = temp - dewpoint;
    return Math.round(spread * METEO_CONSTANTS.cloudBaseMultiplier + elevation);
}

/**
 * Bestes Zeitfenster finden
 */
export function findBestWindow(dayStr) {
    return findBestWindowForHours(state.hourlyWeather, state.hourlyAssessments, dayStr);
}

export function getThermalDayAssessment(dayStr) {
    return assessThermalDay(state.hourlyWeather, state.hourlyAssessments, dayStr);
}

/**
 * PHASE 1 SAFETY: Prüfe ob ein Tag Killer-Bedingungen hat
 */
export function dayHasKillers(dayStr) {
    for (let h = 6; h <= 20; h++) {
        const ts = dayStr + 'T' + h.toString().padStart(2, '0') + ':00';
        const idx = state.hourlyWeather.findIndex(hour => hour.time === ts);
        if (idx === -1) continue;
        if ((getHourAssessment(idx)?.hardBlockers?.length || 0) > 0) return true;
    }
    return false;
}

/**
 * Sonnenzeiten aktualisieren
 */
export function updateSunTimes(di) {
    if (!state.dailyData?.sunrise) return;

    const sr = new Date(state.dailyData.sunrise[di]);
    const ss = new Date(state.dailyData.sunset[di]);
    const ms = ss - sr;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);

    document.getElementById('sunrise').textContent = sr.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('sunset').textContent = ss.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('daylight').textContent = h + 'h ' + m + 'm';
}

/**
 * PHASE 2: Berechnet ob Bedingungen anfängerfreundlich sind
 * @param {number} i - Index in state.hourlyWeather
 * @returns {Object} Beginner assessment
 */
export function calculateBeginnerSafety(i) {
    const hour = state.hourlyWeather[i];
    if (!hour) return { isBeginner: false, missingData: true };

    const metrics = deriveHourMetrics(hour);
    const { ws, wg, w900, w850, w800, w700, cape, visibility: vis, spread } = metrics;

    // Validierung: Nur wenn alle kritischen Daten vorhanden sind
    if (ws === null || w850 === null) {
        return { isBeginner: false, missingData: true, checks: {} };
    }

    const gustDiff = wg !== null ? wg - ws : 0;
    const grad = Math.abs(w850 - ws);

    // Einzelne Checks für Anfängerfreundlichkeit (Werte aus BEGINNER_LIMITS)
    // Strenger als normale Grün-Limits für perfekte Einsteiger-Bedingungen
    const checks = {
        groundWind: {
            pass: ws < BEGINNER_LIMITS.groundWind,
            value: ws,
            threshold: BEGINNER_LIMITS.groundWind,
            label: 'Bodenwind',
            reason: ws >= BEGINNER_LIMITS.groundWind ? 'Bodenwind zu stark für entspanntes Aufziehen' : null
        },
        gustDiff: {
            pass: gustDiff < BEGINNER_LIMITS.gustDiff,
            value: gustDiff,
            threshold: BEGINNER_LIMITS.gustDiff,
            label: 'Böendifferenz',
            reason: gustDiff >= BEGINNER_LIMITS.gustDiff ? 'Starke Böen = turbulente Luft' : null
        },
        wind1000: {
            pass: w900 === null || w900 < BEGINNER_LIMITS.w900,
            value: w900 || 0,
            threshold: BEGINNER_LIMITS.w900,
            label: 'Wind 1000m',
            reason: w900 >= BEGINNER_LIMITS.w900 ? 'Höhenwind 1000m erhöht' : null
        },
        upperWind: {
            pass: w850 < BEGINNER_LIMITS.w850,
            value: w850,
            threshold: BEGINNER_LIMITS.w850,
            label: 'Höhenwind (1500m)',
            reason: w850 >= BEGINNER_LIMITS.w850 ? 'Höhenwind erhöht (Lee-Gefahr)' : null
        },
        gradient: {
            pass: grad < BEGINNER_LIMITS.gradient,
            value: grad,
            threshold: BEGINNER_LIMITS.gradient,
            label: 'Windgradient',
            reason: grad >= BEGINNER_LIMITS.gradient ? 'Zu großer Unterschied Boden/Höhe' : null
        },
        wind2000: {
            pass: w800 === null || w800 < BEGINNER_LIMITS.w800,
            value: w800 || 0,
            threshold: BEGINNER_LIMITS.w800,
            label: 'Wind 2000m',
            reason: w800 >= BEGINNER_LIMITS.w800 ? 'Höhenwind 2000m zu stark' : null
        },
        wind3000: {
            pass: w700 === null || w700 < BEGINNER_LIMITS.w700,
            value: w700 || 0,
            threshold: BEGINNER_LIMITS.w700,
            label: 'Wind 3000m',
            reason: w700 >= BEGINNER_LIMITS.w700 ? 'Höhenwind 3000m zu stark' : null
        },
        cape: {
            pass: cape === null || cape < BEGINNER_LIMITS.cape,
            value: cape || 0,
            threshold: BEGINNER_LIMITS.cape,
            label: 'Thermik-Energie',
            reason: cape >= BEGINNER_LIMITS.cape ? 'Unruhige, starke Thermik möglich' : null
        },
        visibility: {
            pass: vis === null || vis > BEGINNER_LIMITS.visibility,
            value: vis ? vis / 1000 : 10,
            threshold: BEGINNER_LIMITS.visibility / 1000,
            label: 'Sicht',
            reason: vis <= BEGINNER_LIMITS.visibility ? 'Eingeschränkte Sicht' : null
        },
        spread: {
            pass: spread === null || spread >= BEGINNER_LIMITS.spread,
            value: spread || 0,
            threshold: BEGINNER_LIMITS.spread,
            label: 'Spread',
            reason: spread !== null && spread < BEGINNER_LIMITS.spread ? 'Nebelgefahr (Spread zu niedrig)' : null
        }
    };

    // Alle Checks bestanden?
    const allPassed = Object.values(checks).every(check => check.pass);
    const failedChecks = Object.entries(checks)
        .filter(([key, check]) => !check.pass)
        .map(([key, check]) => ({
            name: check.label,
            reason: check.reason,
            value: check.value,
            threshold: check.threshold
        }));

    return {
        isBeginner: allPassed,
        checks: checks,
        missingData: false,
        label: allPassed ? 'Perfekt für Einsteiger & Genussflieger' : null,
        failedChecks: failedChecks
    };
}

/**
 * PHASE 2: Generiert verständliche Risiko-Erklärungen
 * @param {number} i - Index in state.hourlyWeather
 * @param {number} score - Aktueller Score (1-3)
 * @returns {Array} Array von Risiko-Objekten
 */
// ======= ZENTRALISIERTE BEWERTUNGSFUNKTIONEN =======
// (Ursprünglich in ui.js, jetzt hier als Single Source of Truth)

/**
 * Wind bewerten (Score 1-3)
 * @param {number} ws - Bodenwind in km/h
 * @param {number} wg - Böen in km/h
 * @param {number} w850 - Wind auf 850hPa (~1500m) in km/h
 * @param {number} w800 - Wind auf 800hPa (~2000m) in km/h
 * @param {number} w700 - Wind auf 700hPa (~3000m) in km/h
 * @param {number} grad - Gradient Boden-1500m in km/h
 * @param {number} grad3000 - Gradient Boden-3000m in km/h
 * @returns {1|2|3} Score: 1=nogo, 2=caution, 3=go
 */
export function evaluateWind(ws, wg, w900, w850, w800, w700, grad, grad3000) {
    const L = getEffectiveLimits();
    const gustFactor = getGustFactor(ws, wg);
    const gustSpread = wg - ws;
    if (ws > L.wind.surface.yellow || wg > L.wind.gusts.yellow ||
        w900 > L.wind.w900.yellow || w850 > L.wind.w850.yellow ||
        w800 > L.wind.w800.yellow || w700 > L.wind.w700.yellow ||
        grad > L.wind.gradient.yellow || grad3000 > L.wind.gradient3000.yellow ||
        gustSpread > L.wind.gustSpread.yellow ||
        (gustFactor > L.wind.gustFactor.yellow && wg > L.wind.gustFactorMinWind.yellow)) return 1;
    if (ws > L.wind.surface.green || wg > L.wind.gusts.green ||
        w900 > L.wind.w900.green || w850 > L.wind.w850.green ||
        w800 > L.wind.w800.green || w700 > L.wind.w700.green ||
        grad > L.wind.gradient.green || grad3000 > L.wind.gradient3000.green ||
        gustSpread > L.wind.gustSpread.green ||
        (gustFactor > L.wind.gustFactor.green && wg > L.wind.gustFactorMinWind.green)) return 2;
    return 3;
}

/**
 * Thermik/Stabilität bewerten (Score 1-3)
 * Hinweis: Spread-Bewertung nur für Thermik-Qualität, Nebel über getFogRisk()
 * @param {number|null} spread - Temperatur minus Taupunkt in °C
 * @param {number} cape - Convective Available Potential Energy in J/kg
 * @param {number} li - Lifted Index (negativer = labiler)
 * @returns {1|2|3} Score: 1=nogo, 2=caution, 3=go
 */
export function evaluateThermik(spread, cape, li) {
    const L = getEffectiveLimits();
    // CAPE und Lifted Index bewerten
    if (cape > L.cape.yellow || li < L.liftedIndex.yellow) return 1;
    if (cape > L.cape.green || li < L.liftedIndex.green) return 2;
    // Spread nur noch für Thermik-Qualität (sehr trocken = schlechte Thermik)
    if (spread !== null && spread > L.spread.max) return 2;
    return 3;
}

/**
 * Wolken/Sicht bewerten (Score 1-3)
 * Nutzt intelligente Nebel-Erkennung wenn spread und windSpeed verfügbar
 * @param {number} cloudTotal - Gesamtbewölkung in %
 * @param {number} cloudLow - Tiefe Bewölkung (<2km) in %
 * @param {number} visibility - Sichtweite in Metern
 * @param {number|null} [spread=null] - Spread für Nebel-Erkennung
 * @param {number|null} [windSpeed=null] - Bodenwind für Nebel-Erkennung
 * @returns {1|2|3} Score: 1=nogo, 2=caution, 3=go
 */
export function evaluateClouds(cloudTotal, cloudLow, visibility, spread = null, windSpeed = null) {
    const L = getEffectiveLimits();
    // Tiefe Wolken sind immer kritisch (thermikdämpfend)
    if (cloudLow > L.clouds.low.yellow) return 1;

    // Intelligente Nebel-Erkennung wenn alle Parameter verfügbar
    if (spread !== null && windSpeed !== null) {
        const fogRisk = getFogRisk(spread, windSpeed, visibility);
        if (fogRisk === 'severe') return 1;
        if (fogRisk === 'likely' || fogRisk === 'possible') return 2;
    } else {
        // Fallback: Nur Sichtweite bewerten
        if (visibility < L.fog.visibilitySevere) return 1;
        if (visibility < L.fog.visibilityWarning) return 2;
    }

    // Restliche Wolken-Bewertung
    if (cloudTotal > L.clouds.total.yellow || cloudLow > L.clouds.low.green || visibility < L.visibility.green) return 2;
    return 3;
}

/**
 * Niederschlag bewerten (Score 1-3)
 * @param {number} precip - Niederschlagsmenge in mm
 * @param {number} precipProb - Niederschlagswahrscheinlichkeit in %
 * @param {number} cape - CAPE für Gewitterrisiko
 * @param {number} [showers=0] - Konvektiver Niederschlag (Schauer) in mm
 * @returns {1|2|3} Score: 1=nogo, 2=caution, 3=go
 */
export function evaluatePrecip(precip, precipProb, cape, showers = 0) {
    const L = getEffectiveLimits();
    if (precip > L.precip.yellow || cape > L.cape.yellow || showers > L.showers.yellow) return 1;
    if (precip > L.precip.green || precipProb > L.precipProb.yellow || showers > L.showers.green) return 2;
    return 3;
}

export function getRiskExplanation(i, score) {
    const assessment = getHourAssessment(i);
    if (!assessment || score === 3) return [];

    return assessment.reasons.map(reason => ({
        severity: reason.level === 'red' ? 'high' : 'medium',
        category: reason.category,
        icon: reason.level === 'red' ? '⚠️' : 'ℹ️',
        title: reason.hardBlocker ? 'Kritischer Parameter' : 'Erhöhter Parameter',
        description: reason.text,
        advice: reason.hardBlocker
            ? 'Bedingungen kritisch prüfen und im Zweifel nicht starten'
            : 'Bedingungen und persönliche Reserven vor Ort prüfen'
    }));
}
// Quellen: OpenWindMap/Pioupiou + Lawinenwarndienste (avalanche.report)

// Cache für Live-Wind-Daten
let liveWindCache = {
    pioupiou: { data: null, timestamp: 0 },
    avalanche: { data: null, timestamp: 0 }
};


/**
 * Holt alle Pioupiou/OpenWindMap Stationen (mit Cache)
 * @returns {Promise<Array>} Array aller Stationen
 */
async function fetchAllPioupiouStations() {
    const now = Date.now();
    const cache = liveWindCache.pioupiou;

    // Cache prüfen (60 Sekunden TTL wegen API Rate Limit)
    if (cache.data && (now - cache.timestamp) < API_CONFIG.liveWindCacheTTL) {
        return cache.data;
    }

    try {
        const response = await fetch(API_CONFIG.pioupiouUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();

        // Cache aktualisieren
        cache.data = result.data || [];
        cache.timestamp = now;

        return cache.data;
    } catch (error) {
        console.warn('OpenWindMap API Fehler:', error);
        // Bei Fehler: alte Cache-Daten zurückgeben falls vorhanden
        return cache.data || [];
    }
}

/**
 * Generiert die URL für avalanche.report Wetterstationen
 * Format: YYYY-MM-DD_HH-00_stations.geojson (stündlich)
 * @returns {string} URL zur aktuellen GeoJSON-Datei
 */
function getAvalancheReportUrl() {
    const now = new Date();
    // Auf volle Stunde abrunden
    now.setMinutes(0, 0, 0);

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');

    return `${API_CONFIG.avalancheReportUrl}${year}-${month}-${day}_${hour}-00_stations.geojson`;
}

/**
 * Holt alle Lawinenwarndienst-Stationen (mit Cache)
 * Quellen: LWD Tirol, Bayern, Salzburg, Südtirol, GeoSphere Austria
 * @returns {Promise<Array>} Array aller Stationen im einheitlichen Format
 */
async function fetchAllAvalancheStations() {
    if (!API_CONFIG.avalancheReportEnabled) {
        return [];
    }

    const now = Date.now();
    const cache = liveWindCache.avalanche;

    // Cache prüfen
    if (cache.data && (now - cache.timestamp) < API_CONFIG.liveWindCacheTTL) {
        return cache.data;
    }

    try {
        const url = getAvalancheReportUrl();
        const response = await fetch(url);

        if (!response.ok) {
            // Fallback: Versuche vorherige Stunde
            const fallbackUrl = url.replace(/_\d{2}-00_/, (match) => {
                const hour = parseInt(match.slice(1, 3));
                const prevHour = hour > 0 ? hour - 1 : 23;
                return `_${String(prevHour).padStart(2, '0')}-00_`;
            });
            const fallbackResponse = await fetch(fallbackUrl);
            if (!fallbackResponse.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const geojson = await fallbackResponse.json();
            cache.data = geojson.features || [];
            cache.timestamp = now;
            return cache.data;
        }

        const geojson = await response.json();

        // Cache aktualisieren
        cache.data = geojson.features || [];
        cache.timestamp = now;

        return cache.data;
    } catch (error) {
        console.warn('Avalanche.report API Fehler:', error);
        // Bei Fehler: alte Cache-Daten zurückgeben falls vorhanden
        return cache.data || [];
    }
}

/**
 * Konvertiert avalanche.report Station ins einheitliche Format
 * @param {Object} feature - GeoJSON Feature
 * @param {number} targetLat - Ziel-Breitengrad für Distanzberechnung
 * @param {number} targetLon - Ziel-Längengrad für Distanzberechnung
 * @returns {Object|null} Station im einheitlichen Format oder null wenn ungültig
 */
function parseAvalancheStation(feature, targetLat, targetLon) {
    const props = feature.properties;
    const coords = feature.geometry?.coordinates;

    // Mindestens Position und Windgeschwindigkeit erforderlich
    if (!coords || coords.length < 2 || props.WG === undefined) {
        return null;
    }

    const [lon, lat, elevation] = coords;
    const distance = haversineDistance(targetLat, targetLon, lat, lon);

    // Wind - API liefert bereits km/h
    const windSpeed = props.WG !== null ? Math.round(props.WG) : null;
    const windGust = props.WG_BOE !== null ? Math.round(props.WG_BOE) : null;

    // Alter der Messung berechnen
    const measurementDate = props.date ? new Date(props.date) : null;
    const ageMinutes = measurementDate
        ? Math.round((Date.now() - measurementDate.getTime()) / 60000)
        : null;

    // Nur aktuelle Messungen (max 2 Stunden alt)
    if (ageMinutes !== null && ageMinutes > 120) {
        return null;
    }

    return {
        id: `lwd-${props.name?.replace(/\s+/g, '-').toLowerCase() || 'unknown'}`,
        name: props.name || 'Unbekannte Station',
        distance: Math.round(distance * 10) / 10,
        lat: lat,
        lon: lon,
        elevation: elevation ? Math.round(elevation) : null,
        windSpeed: windSpeed,
        windGust: windGust,
        windMin: null,  // Nicht verfügbar
        windDirection: props.WR,
        windDirectionText: getWindDir(props.WR),
        temperature: props.LT !== undefined ? Math.round(props.LT * 10) / 10 : null,
        lastUpdate: measurementDate,
        ageMinutes: ageMinutes,
        source: 'lwd',
        operator: props.operator || 'Lawinenwarndienst'
    };
}


/**
 * Holt Live-Windstationen in der Nähe eines Standorts
 * Kombiniert Daten von OpenWindMap/Pioupiou und Lawinenwarndiensten
 * @param {number} lat - Breitengrad
 * @param {number} lon - Längengrad
 * @param {number} radiusKm - Suchradius in km (default aus Config)
 * @param {number} maxStations - Max. Anzahl Stationen (default aus Config)
 * @returns {Promise<Array>} Sortierte Liste der nächsten Stationen
 */
export async function fetchNearbyLiveWind(lat, lon, radiusKm = null, maxStations = null) {
    const radius = radiusKm || API_CONFIG.liveWindRadius;
    const max = maxStations || API_CONFIG.liveWindMaxStations;

    // Beide Quellen parallel abrufen
    const [pioupiouStations, avalancheFeatures] = await Promise.all([
        fetchAllPioupiouStations(),
        fetchAllAvalancheStations()
    ]);

    const allNearbyStations = [];

    // === Pioupiou/OpenWindMap Stationen verarbeiten ===
    if (pioupiouStations && pioupiouStations.length > 0) {
        const pioupiouNearby = pioupiouStations
            .filter(station => {
                // Nur Stationen mit gültiger Position und aktuellen Messwerten
                if (!station.location?.latitude || !station.location?.longitude) return false;
                if (!station.measurements?.date) return false;

                // Messung nicht älter als 2 Stunden
                const measurementAge = Date.now() - new Date(station.measurements.date).getTime();
                if (measurementAge > 2 * 60 * 60 * 1000) return false;

                return true;
            })
            .map(station => {
                const distance = haversineDistance(
                    lat, lon,
                    station.location.latitude,
                    station.location.longitude
                );

                const m = station.measurements;
                return {
                    id: `piou-${station.id}`,
                    name: station.meta?.name || `Station ${station.id}`,
                    distance: Math.round(distance * 10) / 10,
                    lat: station.location.latitude,
                    lon: station.location.longitude,
                    elevation: station.location.altitude ? Math.round(station.location.altitude) : null,
                    windSpeed: m.wind_speed_avg !== null ? Math.round(m.wind_speed_avg) : null,
                    windGust: m.wind_speed_max !== null ? Math.round(m.wind_speed_max) : null,
                    windMin: m.wind_speed_min !== null ? Math.round(m.wind_speed_min) : null,
                    windDirection: m.wind_heading,
                    windDirectionText: getWindDir(m.wind_heading),
                    temperature: null,
                    lastUpdate: new Date(m.date),
                    ageMinutes: Math.round((Date.now() - new Date(m.date).getTime()) / 60000),
                    source: 'openwindmap',
                    operator: 'OpenWindMap'
                };
            })
            .filter(station => station.distance <= radius);

        allNearbyStations.push(...pioupiouNearby);
    }

    // === Lawinenwarndienst Stationen verarbeiten ===
    if (avalancheFeatures && avalancheFeatures.length > 0) {
        const avalancheNearby = avalancheFeatures
            .map(feature => parseAvalancheStation(feature, lat, lon))
            .filter(station => station !== null && station.distance <= radius);

        allNearbyStations.push(...avalancheNearby);
    }

    // Nach Distanz sortieren und auf max begrenzen
    // Bei gleicher Distanz: LWD-Stationen bevorzugen (höhere Qualität)
    const sortedStations = allNearbyStations
        .sort((a, b) => {
            const distDiff = a.distance - b.distance;
            if (Math.abs(distDiff) < 1) {
                // Bei ähnlicher Distanz: LWD bevorzugen
                if (a.source === 'lwd' && b.source !== 'lwd') return -1;
                if (b.source === 'lwd' && a.source !== 'lwd') return 1;
            }
            return distDiff;
        })
        .slice(0, max);

    return sortedStations;
}


