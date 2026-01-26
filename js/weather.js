/**
 * SkyCheck - Wetter-Modul
 * API-Calls und Wetterdaten-Verarbeitung
 * v9 - Mit Datenvalidierung
 */

import { state } from './state.js';
import { LIMITS, BEGINNER_LIMITS } from './config.js';
import { isInIconD2Coverage, isInIconEUCoverage, isInIconCoverage, getGustFactor, isInAlpineRegion, escapeHtml } from './utils.js';

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
        // v8: Erweiterte hourly Parameter
        const params = new URLSearchParams({
            latitude: lat,
            longitude: lon,
            hourly: 'temperature_2m,dew_point_2m,precipitation,precipitation_probability,showers,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,lifted_index,freezing_level_height,weather_code',
            daily: 'sunrise,sunset',
            wind_speed_unit: 'kmh',
            timezone: timezone,
            forecast_days: 3,
            models: modelChoice
        });

        // v9: Höhenwinde (750hPa entfernt - nicht zuverlässig verfügbar)
        const pressureParams = new URLSearchParams({
            latitude: lat,
            longitude: lon,
            hourly: 'wind_speed_850hPa,wind_speed_800hPa,wind_speed_700hPa,wind_direction_850hPa,wind_direction_800hPa,wind_direction_700hPa,boundary_layer_height',
            wind_speed_unit: 'kmh',
            timezone: timezone,
            forecast_days: 3,
            models: modelChoice
        });

        // API-Timeout: Max 15 Sekunden warten
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        let d1, d2;
        try {
            const [r1, r2] = await Promise.all([
                fetch('https://api.open-meteo.com/v1/forecast?' + params, { signal: controller.signal }),
                fetch('https://api.open-meteo.com/v1/forecast?' + pressureParams, { signal: controller.signal })
            ]);
            clearTimeout(timeoutId);
            d1 = await r1.json();
            d2 = await r2.json();
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                throw new Error('Zeitüberschreitung - Server antwortet nicht');
            }
            throw fetchError;
        }

        // Prüfe auf API-Fehler
        if (d1.error || d2.error) {
            throw new Error(d1.reason || d2.reason || 'API-Fehler');
        }

        // Daten zusammenführen (750hPa entfernt)
        if (d2.hourly) {
            d1.hourly.wind_speed_850hPa = d2.hourly.wind_speed_850hPa;
            d1.hourly.wind_speed_800hPa = d2.hourly.wind_speed_800hPa;
            d1.hourly.wind_speed_700hPa = d2.hourly.wind_speed_700hPa;
            d1.hourly.wind_direction_850hPa = d2.hourly.wind_direction_850hPa;
            d1.hourly.wind_direction_800hPa = d2.hourly.wind_direction_800hPa;
            d1.hourly.wind_direction_700hPa = d2.hourly.wind_direction_700hPa;
            d1.hourly.boundary_layer_height = d2.hourly.boundary_layer_height;
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
            setTimeout(() => state.map.invalidateSize(), 100);
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
        // Nach 8 Sekunden zurücksetzen
        setTimeout(() => {
            initialState.innerHTML = `
                <div class="initial-state-icon">🗺️</div>
                <h3>Wähle einen Standort</h3>
                <p>Klicke auf die Karte oder nutze GPS.</p>
            `;
        }, 8000);
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
 * Stunden-Score berechnen (3=go, 2=caution, 1=nogo)
 */
export function getHourScore(i) {
    const h = state.hourlyData;
    if (!h) return 1;

    // Wind-Parameter
    const ws = h.wind_speed_10m[i] || 0;
    const wg = h.wind_gusts_10m[i] || 0;
    const w850 = h.wind_speed_850hPa?.[i] || 0;
    const w800 = h.wind_speed_800hPa?.[i] || 0;
    const w700 = h.wind_speed_700hPa?.[i] || 0;
    const grad = Math.abs(w850 - ws);
    const grad3000 = Math.abs(w700 - ws);  // FIX: Gradient zu Boden, nicht zu 850hPa
    const gustSpread = wg - ws;  // NEU: Böigkeits-Differenz
    const gustFactor = getGustFactor(ws, wg);

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

    // === NO-GO Kriterien (Score 1) ===
    // Wind (inkl. neue gustSpread-Prüfung)
    if (ws > LIMITS.wind.surface.yellow || wg > LIMITS.wind.gusts.yellow ||
        gustSpread > LIMITS.wind.gustSpread.yellow ||
        w850 > LIMITS.wind.w850.yellow || w800 > LIMITS.wind.w800.yellow || w700 > LIMITS.wind.w700.yellow ||
        grad > LIMITS.wind.gradient.yellow || grad3000 > LIMITS.wind.gradient3000.yellow) return 1;
    // Thermik
    if (spread < LIMITS.spread.min || cape > LIMITS.cape.yellow || li < LIMITS.liftedIndex.yellow) return 1;
    // Wolken/Sicht
    if (cloudLow > LIMITS.clouds.low.yellow || vis < LIMITS.visibility.yellow) return 1;
    // Niederschlag
    if (precip > LIMITS.precip.yellow || showers > LIMITS.showers.yellow) return 1;

    // === VORSICHT Kriterien (Score 2) ===
    // Wind (inkl. neue gustSpread-Prüfung)
    if (ws > LIMITS.wind.surface.green || wg > LIMITS.wind.gusts.green ||
        gustSpread > LIMITS.wind.gustSpread.green ||
        w850 > LIMITS.wind.w850.green || w800 > LIMITS.wind.w800.green || w700 > LIMITS.wind.w700.green ||
        grad > LIMITS.wind.gradient.green || grad3000 > LIMITS.wind.gradient3000.green) return 2;
    // Thermik
    if (spread < LIMITS.spread.optimalMin || spread > LIMITS.spread.max || cape > LIMITS.cape.green || li < LIMITS.liftedIndex.green) return 2;
    // Wolken/Sicht
    if (cloudTotal > LIMITS.clouds.total.yellow || cloudLow > LIMITS.clouds.low.green || vis < LIMITS.visibility.green) return 2;
    // Niederschlag
    if (precip > LIMITS.precip.green || precipProb > LIMITS.precipProb.yellow || showers > LIMITS.showers.green) return 2;

    // === Alles OK (Score 3) ===
    return 3;
}

/**
 * v8 NEU: Wolkenbasis berechnen aus Spread × 125m + Stationshöhe
 */
export function calculateCloudBase(temp, dewpoint, elevation) {
    const spread = temp - dewpoint;
    return Math.round(spread * 125 + elevation);
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
 */
export function evaluateWind(ws, wg, w850, w800, w700, grad, grad3000) {
    const gustFactor = getGustFactor(ws, wg);
    const gustSpread = wg - ws;
    if (ws > LIMITS.wind.surface.yellow || wg > LIMITS.wind.gusts.yellow || w850 > LIMITS.wind.w850.yellow ||
        w800 > LIMITS.wind.w800.yellow || w700 > LIMITS.wind.w700.yellow ||
        grad > LIMITS.wind.gradient.yellow || grad3000 > LIMITS.wind.gradient3000.yellow ||
        gustSpread > LIMITS.wind.gustSpread.yellow ||
        (gustFactor > LIMITS.wind.gustFactor.yellow && wg > LIMITS.wind.gustFactorMinWind.yellow)) return 1;
    if (ws > LIMITS.wind.surface.green || wg > LIMITS.wind.gusts.green || w850 > LIMITS.wind.w850.green ||
        w800 > LIMITS.wind.w800.green || w700 > LIMITS.wind.w700.green ||
        grad > LIMITS.wind.gradient.green || grad3000 > LIMITS.wind.gradient3000.green ||
        gustSpread > LIMITS.wind.gustSpread.green ||
        (gustFactor > LIMITS.wind.gustFactor.green && wg > LIMITS.wind.gustFactorMinWind.green)) return 2;
    return 3;
}

/**
 * Thermik bewerten (Score 1-3)
 */
export function evaluateThermik(spread, cape, li) {
    if (spread !== null && spread < LIMITS.spread.min) return 1;
    if (cape > LIMITS.cape.yellow || li < LIMITS.liftedIndex.yellow) return 1;
    if (spread !== null && (spread < LIMITS.spread.optimalMin || spread > LIMITS.spread.max)) return 2;
    if (cape > LIMITS.cape.green || li < LIMITS.liftedIndex.green) return 2;
    return 3;
}

/**
 * Wolken/Sicht bewerten (Score 1-3)
 */
export function evaluateClouds(cloudTotal, cloudLow, visibility) {
    if (cloudLow > LIMITS.clouds.low.yellow || visibility < LIMITS.visibility.yellow) return 1;
    if (cloudTotal > LIMITS.clouds.total.yellow || cloudLow > LIMITS.clouds.low.green || visibility < LIMITS.visibility.green) return 2;
    return 3;
}

/**
 * Niederschlag bewerten (Score 1-3)
 */
export function evaluatePrecip(precip, precipProb, cape, showers = 0) {
    if (precip > LIMITS.precip.yellow || cape > LIMITS.cape.yellow || showers > LIMITS.showers.yellow) return 1;
    if (precip > LIMITS.precip.green || precipProb > LIMITS.precipProb.yellow || showers > LIMITS.showers.green) return 2;
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
    const vis = validateValue(h.visibility[i], 10000);
    const grad = Math.abs(w850 - ws);
    const gustDiff = wg - ws;

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

    // Sicht-Risiken (Schwellenwerte aus LIMITS)
    if (vis < LIMITS.visibility.yellow) {
        risks.push({
            severity: 'high',
            category: 'visibility',
            icon: '🌫️',
            title: 'Sehr schlechte Sicht',
            description: `Nur ${(vis/1000).toFixed(1)} km Sicht – Orientierung stark erschwert`,
            advice: 'Landeplatz muss sicher erkennbar sein, evtl. nicht starten'
        });
    } else if (vis < LIMITS.visibility.green) {
        risks.push({
            severity: 'medium',
            category: 'visibility',
            icon: '🌁',
            title: 'Eingeschränkte Sicht',
            description: `${(vis/1000).toFixed(1)} km Sicht – Reduzierte Fernsicht`,
            advice: 'Gelände gut kennen, früh orientieren'
        });
    }

    return risks;
}
