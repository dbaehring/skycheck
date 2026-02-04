/**
 * SkyCheck - Wetter-Modul
 * API-Calls und Wetterdaten-Verarbeitung
 * v9 - Mit Datenvalidierung
 */

import { state } from './state.js';
import { LIMITS, BEGINNER_LIMITS, API_CONFIG, UI_CONFIG, METEO_CONSTANTS } from './config.js';
import { isInIconD2Coverage, isInIconEUCoverage, getGustFactor, isInAlpineRegion, escapeHtml } from './utils.js';

/**
 * Gibt die effektiven Limits zurück (Custom wenn gesetzt, sonst Default)
 * @returns {Object} Limits-Objekt
 */
export function getEffectiveLimits() {
    if (!state.expertMode || !state.customLimits) {
        return LIMITS;
    }
    // Deep-Merge: Custom überschreibt Default
    return deepMerge(LIMITS, state.customLimits);
}

/**
 * Deep-Merge für verschachtelte Objekte
 */
function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else if (source[key] !== undefined && source[key] !== null) {
            result[key] = source[key];
        }
    }
    return result;
}

/**
 * Validates weather data and handles missing values
 * @param {*} value - Raw value from API
 * @param {*} fallback - Fallback value (default: null)
 * @returns {*} Validated value or null if invalid
 */
export function validateValue(value, fallback = null) {
    if (value === null || value === undefined || value === '' ||
        (typeof value === 'number' && isNaN(value))) {
        return fallback;
    }
    return value;
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

    try {
        // v8: Erweiterte hourly Parameter (v10.1: +shortwave_radiation für Thermik-Zeitfenster)
        const params = new URLSearchParams({
            latitude: lat,
            longitude: lon,
            hourly: 'temperature_2m,dew_point_2m,precipitation,precipitation_probability,showers,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,lifted_index,freezing_level_height,weather_code,shortwave_radiation',
            daily: 'sunrise,sunset',
            wind_speed_unit: 'kmh',
            timezone: timezone,
            forecast_days: 3,
            models: modelChoice
        });

        // Höhenwinde auf verschiedenen Druckniveaus
        const pressureParams = new URLSearchParams({
            latitude: lat,
            longitude: lon,
            hourly: 'wind_speed_900hPa,wind_speed_850hPa,wind_speed_800hPa,wind_speed_700hPa,wind_direction_900hPa,wind_direction_850hPa,wind_direction_800hPa,wind_direction_700hPa,boundary_layer_height',
            wind_speed_unit: 'kmh',
            timezone: timezone,
            forecast_days: 3,
            models: modelChoice
        });

        // API-Timeout (konfigurierbar via API_CONFIG)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);

        let d1, d2 = null;
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
            d1 = await mainResult.value.json();

            // Höhenwinde sind optional - App funktioniert auch ohne
            if (pressureResult.status === 'fulfilled') {
                try {
                    d2 = await pressureResult.value.json();
                } catch (e) {
                    console.warn('Höhenwinde-Daten konnten nicht geparst werden:', e);
                }
            } else {
                console.warn('Höhenwinde-Fetch fehlgeschlagen:', pressureResult.reason);
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

        // Daten zusammenführen (nur wenn Höhenwinde verfügbar)
        if (d2?.hourly && !d2.error) {
            d1.hourly.wind_speed_900hPa = d2.hourly.wind_speed_900hPa;
            d1.hourly.wind_speed_850hPa = d2.hourly.wind_speed_850hPa;
            d1.hourly.wind_speed_800hPa = d2.hourly.wind_speed_800hPa;
            d1.hourly.wind_speed_700hPa = d2.hourly.wind_speed_700hPa;
            d1.hourly.wind_direction_900hPa = d2.hourly.wind_direction_900hPa;
            d1.hourly.wind_direction_850hPa = d2.hourly.wind_direction_850hPa;
            d1.hourly.wind_direction_800hPa = d2.hourly.wind_direction_800hPa;
            d1.hourly.wind_direction_700hPa = d2.hourly.wind_direction_700hPa;
            d1.hourly.boundary_layer_height = d2.hourly.boundary_layer_height;
        } else if (!d2?.hourly) {
            // Höhenwinde nicht verfügbar - Warnung in Konsole
            console.warn('⚠️ Höhenwinde nicht verfügbar - Gradient-Bewertung eingeschränkt');
        }

        state.hourlyData = d1.hourly;
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
    btn.classList.add('spinning');
    btn.disabled = true;
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
    const L = getEffectiveLimits();
    // SEVERE: Echte "Waschküche" - fast gesättigt + windstill + schlechte Sicht
    // Oder: Sichtweite unter VFR-Minimum
    if (visibility < L.fog.visibilitySevere) return 'severe';
    if (spread <= L.fog.spreadSevere && windSpeed < L.fog.windThreshold) return 'severe';

    // LIKELY: Hohe Nebelwahrscheinlichkeit - feucht + wenig Wind + mäßige Sicht
    if (spread <= 2.0 && windSpeed < L.fog.windDisperse && visibility < L.fog.visibilityWarning) return 'likely';

    // POSSIBLE: Nebelrisiko besteht - hohe Feuchtigkeit ODER eingeschränkte Sicht
    // Aber: Bei Wind > 12 km/h bildet sich selten Bodennebel
    if (visibility < L.fog.visibilityWarning) return 'possible';
    if (spread < L.fog.spreadWarning && windSpeed < L.fog.windDisperse) return 'possible';

    // UNLIKELY: Gute Sicht und/oder ausreichend trocken
    return 'unlikely';
}

/**
 * Gesamt-Score für eine Stunde berechnen
 * Kombiniert Wind, Thermik, Wolken und Niederschlag
 * @param {number} i - Index in state.hourlyData
 * @returns {1|2|3} Score: 1=nogo (rot), 2=caution (gelb), 3=go (grün)
 */
export function getHourScore(i) {
    const h = state.hourlyData;
    if (!h) return 1;

    const L = getEffectiveLimits();
    // Parameter-Filter aus State (standardmäßig alle aktiv)
    const filter = state.paramFilter || { wind: true, thermik: true, clouds: true, precip: true };

    // Wind-Parameter
    const ws = h.wind_speed_10m[i] || 0;
    const wg = h.wind_gusts_10m[i] || 0;
    const w900 = h.wind_speed_900hPa?.[i] || 0;
    const w850 = h.wind_speed_850hPa?.[i] || 0;
    const w800 = h.wind_speed_800hPa?.[i] || 0;
    const w700 = h.wind_speed_700hPa?.[i] || 0;
    const grad = Math.abs(w850 - ws);
    const grad3000 = Math.abs(w700 - ws);
    const gustSpread = wg - ws;

    // Thermik-Parameter
    const temp = h.temperature_2m?.[i];
    const dew = h.dew_point_2m?.[i];
    const spread = (temp != null && dew != null) ? temp - dew : 10;
    const cape = h.cape?.[i] || 0;
    const li = h.lifted_index?.[i] || 0;

    // Wolken/Sicht-Parameter
    const vis = h.visibility?.[i] || 50000;
    const cloudLow = h.cloud_cover_low?.[i] || 0;
    const cloudTotal = h.cloud_cover?.[i] || 0;

    // Niederschlags-Parameter
    const precip = h.precipitation?.[i] || 0;
    const precipProb = h.precipitation_probability?.[i] || 0;
    const showers = h.showers?.[i] || 0;

    // Nebel-Risiko (intelligente Kombination statt nur Spread)
    const fogRisk = getFogRisk(spread, ws, vis);

    // === NO-GO Kriterien (Score 1) ===
    // Wind (nur wenn Filter aktiv)
    if (filter.wind) {
        if (ws > L.wind.surface.yellow || wg > L.wind.gusts.yellow ||
            gustSpread > L.wind.gustSpread.yellow ||
            w900 > L.wind.w900.yellow || w850 > L.wind.w850.yellow ||
            w800 > L.wind.w800.yellow || w700 > L.wind.w700.yellow ||
            grad > L.wind.gradient.yellow || grad3000 > L.wind.gradient3000.yellow) return 1;
    }
    // Thermik (nur wenn Filter aktiv) - CAPE und Lifted Index, NICHT Nebel
    if (filter.thermik) {
        if (cape > L.cape.yellow || li < L.liftedIndex.yellow) return 1;
    }
    // Wolken/Sicht (nur wenn Filter aktiv) - inkl. Nebelrisiko
    if (filter.clouds) {
        if (cloudLow > L.clouds.low.yellow || fogRisk === 'severe') return 1;
    }
    // Niederschlag (nur wenn Filter aktiv)
    if (filter.precip) {
        if (precip > L.precip.yellow || showers > L.showers.yellow) return 1;
    }

    // === VORSICHT Kriterien (Score 2) ===
    // Wind (nur wenn Filter aktiv)
    if (filter.wind) {
        if (ws > L.wind.surface.green || wg > L.wind.gusts.green ||
            gustSpread > L.wind.gustSpread.green ||
            w900 > L.wind.w900.green || w850 > L.wind.w850.green ||
            w800 > L.wind.w800.green || w700 > L.wind.w700.green ||
            grad > L.wind.gradient.green || grad3000 > L.wind.gradient3000.green) return 2;
    }
    // Thermik (nur wenn Filter aktiv) - CAPE, Lifted Index, sehr trockene Luft
    if (filter.thermik) {
        if (spread > L.spread.max || cape > L.cape.green || li < L.liftedIndex.green) return 2;
    }
    // Wolken/Sicht (nur wenn Filter aktiv) - inkl. Nebelrisiko
    if (filter.clouds) {
        if (cloudTotal > L.clouds.total.yellow || cloudLow > L.clouds.low.green ||
            vis < L.visibility.green || fogRisk === 'likely' || fogRisk === 'possible') return 2;
    }
    // Niederschlag (nur wenn Filter aktiv)
    if (filter.precip) {
        if (precip > L.precip.green || precipProb > L.precipProb.yellow || showers > L.showers.green) return 2;
    }

    // === Alles OK (Score 3) ===
    return 3;
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
    const windows = [];
    let currentWindow = null;

    for (let h = 6; h <= 20; h++) {
        const ts = dayStr + 'T' + h.toString().padStart(2, '0') + ':00';
        const idx = state.hourlyData.time.findIndex(t => t === ts);
        if (idx === -1) continue;

        const sc = getHourScore(idx);
        if (sc === 3) {
            if (!currentWindow) currentWindow = { start: h, end: h, indices: [idx] };
            else {
                currentWindow.end = h;
                currentWindow.indices.push(idx);
            }
        } else {
            if (currentWindow) {
                windows.push(currentWindow);
                currentWindow = null;
            }
        }
    }

    if (currentWindow) windows.push(currentWindow);
    if (windows.length === 0) return null;

    return windows.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a);
}

/**
 * PHASE 1 SAFETY: Prüfe ob ein Tag Killer-Bedingungen hat
 */
export function dayHasKillers(dayStr) {
    for (let h = 6; h <= 20; h++) {
        const ts = dayStr + 'T' + h.toString().padStart(2, '0') + ':00';
        const idx = state.hourlyData.time.findIndex(t => t === ts);
        if (idx === -1) continue;

        const ws = state.hourlyData.wind_speed_10m[idx] || 0;
        const wg = state.hourlyData.wind_gusts_10m[idx] || 0;
        const w700 = state.hourlyData.wind_speed_700hPa?.[idx] || 0;
        const w850 = state.hourlyData.wind_speed_850hPa?.[idx] || 0;
        const grad = Math.abs(w850 - ws);
        const cape = state.hourlyData.cape?.[idx] || 0;
        const vis = state.hourlyData.visibility[idx] || 10000;
        const gustFactor = getGustFactor(ws, wg);

        // Killer-Kriterien (aus LIMITS für Single Source of Truth)
        if (cape > LIMITS.cape.yellow || w700 > LIMITS.wind.w700.yellow || grad > LIMITS.wind.gradient.yellow ||
            vis < LIMITS.visibility.yellow || wg > LIMITS.wind.gusts.yellow || (gustFactor > 1.0 && wg > LIMITS.wind.gusts.green)) {
            return true;
        }
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
 * @param {number} i - Index in hourlyData
 * @returns {Object} Beginner assessment
 */
export function calculateBeginnerSafety(i) {
    const h = state.hourlyData;
    if (!h) return { isBeginner: false, missingData: true };

    const ws = validateValue(h.wind_speed_10m[i], null);
    const wg = validateValue(h.wind_gusts_10m[i], null);
    const w900 = validateValue(h.wind_speed_900hPa?.[i], null);
    const w850 = validateValue(h.wind_speed_850hPa?.[i], null);
    const w800 = validateValue(h.wind_speed_800hPa?.[i], null);
    const w700 = validateValue(h.wind_speed_700hPa?.[i], null);
    const cape = validateValue(h.cape?.[i], null);
    const vis = validateValue(h.visibility[i], null);
    const temp = validateValue(h.temperature_2m[i], null);
    const dew = validateValue(h.dew_point_2m[i], null);
    const spread = (temp !== null && dew !== null) ? temp - dew : null;

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
            reason: w700 >= BEGINNER_LIMITS.w700 ? 'Höhenwind 3000m zu stark (Föhn-Indikator)' : null
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
 * @param {number} i - Index in hourlyData
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
    const risks = [];
    const h = state.hourlyData;
    if (!h || score === 3) return risks; // Keine Erklärung bei Grün

    const ws = validateValue(h.wind_speed_10m[i], 0);
    const wg = validateValue(h.wind_gusts_10m[i], 0);
    const w850 = validateValue(h.wind_speed_850hPa?.[i], 0);
    const w700 = validateValue(h.wind_speed_700hPa?.[i], 0);
    const cape = validateValue(h.cape?.[i], 0);
    const vis = validateValue(h.visibility?.[i], 10000);
    const temp = validateValue(h.temperature_2m?.[i], null);
    const dew = validateValue(h.dew_point_2m?.[i], null);
    const spread = (temp !== null && dew !== null) ? temp - dew : 10;
    const grad = Math.abs(w850 - ws);
    const gustDiff = wg - ws;
    const fogRisk = getFogRisk(spread, ws, vis);

    // Wind-Risiken (Schwellenwerte aus LIMITS)
    if (ws > LIMITS.wind.surface.yellow) {
        risks.push({
            severity: 'high',
            category: 'wind',
            icon: '💨',
            title: 'Starker Bodenwind',
            description: `${Math.round(ws)} km/h am Boden – Schwieriger Start, Sturzgefahr`,
            advice: 'Nur für erfahrene Piloten mit guter Schirmkontrolle'
        });
    } else if (ws > LIMITS.wind.surface.green) {
        risks.push({
            severity: 'medium',
            category: 'wind',
            icon: '🌬️',
            title: 'Erhöhter Bodenwind',
            description: `${Math.round(ws)} km/h – Aktiver Startaufbau erforderlich`,
            advice: 'Rückwärtsstart empfohlen, auf Böen achten'
        });
    }

    // Böen-Risiken
    if (gustDiff > 15) {
        risks.push({
            severity: 'high',
            category: 'gusts',
            icon: '⚡',
            title: 'Starke Böen',
            description: `Böen ${Math.round(wg)} km/h (${Math.round(gustDiff)} über Grundwind) – Sehr turbulent`,
            advice: 'Erhöhte Einklappergefahr, hohe Pilotenbelastung'
        });
    } else if (gustDiff > 10) {
        risks.push({
            severity: 'medium',
            category: 'gusts',
            icon: '💨',
            title: 'Erhöhte Böigkeit',
            description: `Böen ${Math.round(wg)} km/h (${Math.round(gustDiff)} über Grundwind) – Unruhige Luft`,
            advice: 'Aktives Fliegen nötig, Schirm im Blick behalten'
        });
    }

    // Höhenwind-Risiken (Schwellenwerte aus LIMITS)
    if (w700 > LIMITS.wind.w700.yellow) {
        risks.push({
            severity: 'high',
            category: 'upperwind',
            icon: '🏔️',
            title: 'Gefährlicher Höhenwind',
            description: `${Math.round(w700)} km/h in 3000m – Extreme Lee-Turbulenzen möglich`,
            advice: 'Lee-Seiten absolut meiden! Föhngefahr in den Alpen'
        });
    } else if (w700 > LIMITS.wind.w700.green) {
        risks.push({
            severity: 'medium',
            category: 'upperwind',
            icon: '⛰️',
            title: 'Starker Höhenwind',
            description: `${Math.round(w700)} km/h in 3000m – Lee-Turbulenzen möglich`,
            advice: 'Lee-Bereiche meiden, Beschleuniger bereithalten'
        });
    }

    // Gradient-Risiken (Schwellenwerte aus LIMITS)
    if (grad > LIMITS.wind.gradient.yellow) {
        risks.push({
            severity: 'high',
            category: 'gradient',
            icon: '📊',
            title: 'Gefährliche Windscherung',
            description: `${Math.round(grad)} km/h Unterschied Boden/1500m – Starke Turbulenz`,
            advice: 'Beim Aufsteigen auf Schirm achten, abrupte Schirmreaktionen möglich'
        });
    } else if (grad > LIMITS.wind.gradient.green) {
        risks.push({
            severity: 'medium',
            category: 'gradient',
            icon: '📈',
            title: 'Erhöhter Windgradient',
            description: `${Math.round(grad)} km/h Unterschied Boden/1500m`,
            advice: 'Beim Thermikflug auf Windwechsel vorbereitet sein'
        });
    }

    // CAPE/Thermik-Risiken (Schwellenwerte aus LIMITS)
    if (cape > LIMITS.cape.yellow) {
        risks.push({
            severity: 'high',
            category: 'thermal',
            icon: '⛈️',
            title: 'Gewittergefahr',
            description: `CAPE ${Math.round(cape)} J/kg – Gewitterwolken (Cb) können entstehen`,
            advice: 'Früh landen! Wetterentwicklung ständig beobachten'
        });
    } else if (cape > LIMITS.cape.green) {
        risks.push({
            severity: 'medium',
            category: 'thermal',
            icon: '🔥',
            title: 'Kräftige Thermik',
            description: `CAPE ${Math.round(cape)} J/kg – Unruhige, starke Aufwinde möglich`,
            advice: 'Nur für erfahrene Thermikflieger, Wolkenentwicklung beobachten'
        });
    }

    // Nebel/Sicht-Risiken (intelligente Kombination aus Spread, Wind, Sichtweite)
    if (fogRisk === 'severe') {
        // Echte Nebelgefahr oder sehr schlechte Sicht
        if (vis < LIMITS.fog.visibilitySevere) {
            risks.push({
                severity: 'high',
                category: 'visibility',
                icon: '🌫️',
                title: 'Kritisch schlechte Sicht',
                description: `Nur ${(vis/1000).toFixed(1)} km Sicht – VFR-Minimum unterschritten`,
                advice: 'Nicht starten! Orientierung und Landeplatzerkennung unmöglich'
            });
        } else {
            risks.push({
                severity: 'high',
                category: 'fog',
                icon: '🌫️',
                title: 'Hohe Nebelgefahr',
                description: `Spread nur ${spread.toFixed(1)}°C bei ${Math.round(ws)} km/h Wind – Klassische Nebelbedingungen`,
                advice: 'Luft nahezu gesättigt, Bodennebel sehr wahrscheinlich'
            });
        }
    } else if (fogRisk === 'likely') {
        risks.push({
            severity: 'medium',
            category: 'fog',
            icon: '🌁',
            title: 'Nebel wahrscheinlich',
            description: `Spread ${spread.toFixed(1)}°C, Sicht ${(vis/1000).toFixed(1)} km – Feucht und dunstig`,
            advice: 'Webcams prüfen! Lokale Verhältnisse können besser sein (Inversion)'
        });
    } else if (fogRisk === 'possible') {
        risks.push({
            severity: 'medium',
            category: 'visibility',
            icon: '🌥️',
            title: 'Sichteinschränkung möglich',
            description: spread < LIMITS.fog.spreadWarning
                ? `Hohe Luftfeuchtigkeit (Spread ${spread.toFixed(1)}°C) – Dunst oder tiefe Basis möglich`
                : `Sicht ${(vis/1000).toFixed(1)} km – Reduzierte Fernsicht`,
            advice: 'Wetter vor Ort checken, früh orientieren'
        });
    }

    return risks;
}

/**
 * Thermik-Zeitfenster für einen Tag berechnen
 * Analysiert wann Thermik beginnt, peakt und endet basierend auf:
 * - Sonneneinstrahlung (shortwave_radiation)
 * - CAPE (Konvektionsenergie)
 * - Grenzschichthöhe (boundary_layer_height)
 * - Sonnenauf-/untergang
 *
 * @param {string} dayStr - Datum im Format 'YYYY-MM-DD'
 * @param {number} dayIdx - Index des Tages (0=heute, 1=morgen, etc.)
 * @returns {Object} Thermik-Analyse mit Zeitfenster und Intensität
 */
export function analyzeThermicWindow(dayStr, dayIdx) {
    const h = state.hourlyData;
    if (!h || !state.dailyData) return null;

    const sunrise = new Date(state.dailyData.sunrise[dayIdx]);
    const sunset = new Date(state.dailyData.sunset[dayIdx]);
    const sunriseHour = sunrise.getHours() + sunrise.getMinutes() / 60;
    const sunsetHour = sunset.getHours() + sunset.getMinutes() / 60;

    // Thermik-Daten pro Stunde sammeln (6-20 Uhr)
    const hourlyThermic = [];
    let maxRadiation = 0;
    let maxCape = 0;
    let maxBoundaryLayer = 0;

    for (let hour = 6; hour <= 20; hour++) {
        const ts = dayStr + 'T' + hour.toString().padStart(2, '0') + ':00';
        const idx = h.time.findIndex(t => t === ts);
        if (idx === -1) continue;

        const radiation = validateValue(h.shortwave_radiation?.[idx], 0);
        const cape = validateValue(h.cape?.[idx], 0);
        const boundaryLayer = validateValue(h.boundary_layer_height?.[idx], 500);
        const cloudLow = validateValue(h.cloud_cover_low?.[idx], 0);
        const cloudTotal = validateValue(h.cloud_cover?.[idx], 0);
        const temp = validateValue(h.temperature_2m?.[idx], null);
        const dew = validateValue(h.dew_point_2m?.[idx], null);
        const spread = (temp !== null && dew !== null) ? temp - dew : 10;

        if (radiation > maxRadiation) maxRadiation = radiation;
        if (cape > maxCape) maxCape = cape;
        if (boundaryLayer > maxBoundaryLayer) maxBoundaryLayer = boundaryLayer;

        hourlyThermic.push({
            hour,
            idx,
            radiation,
            cape,
            boundaryLayer,
            cloudLow,
            cloudTotal,
            spread
        });
    }

    // Thermik-Qualität pro Stunde berechnen (0-100)
    const thermicQuality = hourlyThermic.map(data => {
        // Faktoren für Thermik-Qualität
        const radiationFactor = maxRadiation > 0 ? (data.radiation / maxRadiation) : 0;
        const capeFactor = Math.min(data.cape / 500, 1); // Cap bei 500 J/kg für "gute" Thermik
        const boundaryFactor = Math.min(data.boundaryLayer / 2000, 1); // 2000m = gute Höhe
        const cloudPenalty = data.cloudLow > 50 ? 0.3 : data.cloudLow > 30 ? 0.7 : 1.0;
        const spreadFactor = data.spread >= 5 && data.spread <= 15 ? 1.0 :
                            data.spread < 3 ? 0.3 :
                            data.spread > 20 ? 0.7 : 0.8;

        // Zeitfaktor: Thermik braucht Zeit zum Aufbauen nach Sonnenaufgang
        const hoursSinceSunrise = data.hour - sunriseHour;
        const hoursUntilSunset = sunsetHour - data.hour;
        let timeFactor = 1.0;
        if (hoursSinceSunrise < 2) timeFactor = hoursSinceSunrise / 2 * 0.5; // Langsamer Aufbau
        if (hoursUntilSunset < 1.5) timeFactor = Math.max(0, hoursUntilSunset / 1.5) * 0.7; // Schnelles Abklingen

        // Gesamtqualität berechnen
        const quality = Math.round(
            radiationFactor * 30 +  // Sonneneinstrahlung 30%
            capeFactor * 25 +       // CAPE 25%
            boundaryFactor * 15 +   // Grenzschicht 15%
            spreadFactor * 15 +     // Spread 15%
            timeFactor * 15         // Tageszeit 15%
        ) * cloudPenalty;

        return {
            ...data,
            quality,
            intensity: quality > 60 ? 'strong' : quality > 35 ? 'moderate' : quality > 15 ? 'weak' : 'none'
        };
    });

    // Thermik-Zeitfenster finden
    let thermicStart = null;
    let thermicEnd = null;
    let peakHour = null;
    let peakQuality = 0;

    thermicQuality.forEach(data => {
        if (data.quality > 15) {
            if (thermicStart === null) thermicStart = data.hour;
            thermicEnd = data.hour;
            if (data.quality > peakQuality) {
                peakQuality = data.quality;
                peakHour = data.hour;
            }
        }
    });

    // Zusammenfassung erstellen
    const hasUsableThermic = thermicStart !== null && peakQuality > 25;
    const thermicDuration = hasUsableThermic ? (thermicEnd - thermicStart + 1) : 0;

    return {
        hasUsableThermic,
        start: thermicStart,
        end: thermicEnd,
        peak: peakHour,
        peakQuality,
        duration: thermicDuration,
        maxBoundaryLayer,
        maxCape,
        hourlyData: thermicQuality,
        summary: hasUsableThermic
            ? `Thermik ${thermicStart}-${thermicEnd}h, Peak ~${peakHour}h`
            : 'Keine brauchbare Thermik erwartet',
        intensity: peakQuality > 60 ? 'strong' : peakQuality > 35 ? 'moderate' : 'weak'
    };
}

// === OpenWindMap/Pioupiou Live-Wind Integration ===

// Cache für Live-Wind-Daten (Rate Limit: 1 Anfrage/60 Sek.)
let liveWindCache = {
    data: null,
    timestamp: 0
};

/**
 * Berechnet Distanz zwischen zwei Koordinaten (Haversine-Formel)
 * @param {number} lat1 - Breitengrad Punkt 1
 * @param {number} lon1 - Längengrad Punkt 1
 * @param {number} lat2 - Breitengrad Punkt 2
 * @param {number} lon2 - Längengrad Punkt 2
 * @returns {number} Distanz in km
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Erdradius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Holt alle Pioupiou/OpenWindMap Stationen (mit Cache)
 * @returns {Promise<Array>} Array aller Stationen
 */
async function fetchAllPioupiouStations() {
    const now = Date.now();

    // Cache prüfen (60 Sekunden TTL wegen API Rate Limit)
    if (liveWindCache.data && (now - liveWindCache.timestamp) < API_CONFIG.liveWindCacheTTL) {
        return liveWindCache.data;
    }

    try {
        const response = await fetch(API_CONFIG.pioupiouUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();

        // Cache aktualisieren
        liveWindCache.data = result.data || [];
        liveWindCache.timestamp = now;

        return liveWindCache.data;
    } catch (error) {
        console.warn('OpenWindMap API Fehler:', error);
        // Bei Fehler: alte Cache-Daten zurückgeben falls vorhanden
        return liveWindCache.data || [];
    }
}

/**
 * Konvertiert Windrichtung in Grad zu Himmelsrichtung
 * @param {number} deg - Windrichtung in Grad
 * @returns {string} Himmelsrichtung (N, NE, E, etc.)
 */
function degToCompass(deg) {
    if (deg === null || deg === undefined) return '-';
    const directions = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO',
                        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(deg / 22.5) % 16;
    return directions[index];
}

/**
 * Holt Live-Windstationen in der Nähe eines Standorts
 * @param {number} lat - Breitengrad
 * @param {number} lon - Längengrad
 * @param {number} radiusKm - Suchradius in km (default aus Config)
 * @param {number} maxStations - Max. Anzahl Stationen (default aus Config)
 * @returns {Promise<Array>} Sortierte Liste der nächsten Stationen
 */
export async function fetchNearbyLiveWind(lat, lon, radiusKm = null, maxStations = null) {
    const radius = radiusKm || API_CONFIG.liveWindRadius;
    const max = maxStations || API_CONFIG.liveWindMaxStations;

    const allStations = await fetchAllPioupiouStations();

    if (!allStations || allStations.length === 0) {
        return [];
    }

    // Stationen mit Distanz anreichern und filtern
    const nearbyStations = allStations
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
            const distance = calculateDistance(
                lat, lon,
                station.location.latitude,
                station.location.longitude
            );

            const m = station.measurements;
            return {
                id: station.id,
                name: station.meta?.name || `Station ${station.id}`,
                distance: Math.round(distance * 10) / 10,
                lat: station.location.latitude,
                lon: station.location.longitude,
                windSpeed: m.wind_speed_avg !== null ? Math.round(m.wind_speed_avg * 3.6) : null, // m/s → km/h
                windGust: m.wind_speed_max !== null ? Math.round(m.wind_speed_max * 3.6) : null,
                windMin: m.wind_speed_min !== null ? Math.round(m.wind_speed_min * 3.6) : null,
                windDirection: m.wind_heading,
                windDirectionText: degToCompass(m.wind_heading),
                lastUpdate: new Date(m.date),
                ageMinutes: Math.round((Date.now() - new Date(m.date).getTime()) / 60000),
                source: 'openwindmap'
            };
        })
        .filter(station => station.distance <= radius)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, max);

    return nearbyStations;
}

/**
 * Formatiert das Alter einer Messung
 * @param {number} minutes - Alter in Minuten
 * @returns {string} Formatierter String
 */
export function formatMeasurementAge(minutes) {
    if (minutes < 1) return 'gerade eben';
    if (minutes < 60) return `vor ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `vor ${hours}h ${minutes % 60}min`;
}
