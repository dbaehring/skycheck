/**
 * SkyCheck - UI-Modul
 * DOM-Updates, Rendering, Darstellungs-Logik
 * v9 - Mit formatValue für sichere Anzeige
 */

import { state } from './state.js';
import { LIMITS, STORAGE_KEYS, UI_CONFIG, METEO_CONSTANTS } from './config.js';
import {
    getWindDir, getColorClass, getColorClassRev, getSpreadColor,
    scoreToColor, getTrend, getGustFactor, getWeatherInfo, isInAlpineRegion
} from './utils.js';
import {
    getHourScore, findBestWindow, updateSunTimes, calculateCloudBase, validateValue,
    calculateBeginnerSafety, getRiskExplanation, getFogRisk,
    // Zentralisierte Bewertungsfunktionen (Single Source of Truth)
    evaluateWind, evaluateThermik, evaluateClouds, evaluatePrecip
} from './weather.js';

// DOM-Cache für Performance (vermeidet wiederholte getElementById-Aufrufe)
let domCache = null;

/**
 * Initialisiert oder gibt den DOM-Cache zurück
 * @returns {Object} Gecachte DOM-Referenzen
 */
function getDomCache() {
    if (!domCache) {
        domCache = {
            // Wind
            windSurface: document.getElementById('windSurface'),
            windDirSurface: document.getElementById('windDirSurface'),
            windGusts: document.getElementById('windGusts'),
            gustSpread: document.getElementById('gustSpread'),
            wind850: document.getElementById('wind850'),
            windDir850: document.getElementById('windDir850'),
            wind800: document.getElementById('wind800'),
            windDir800: document.getElementById('windDir800'),
            wind700: document.getElementById('wind700'),
            windDir700: document.getElementById('windDir700'),
            windGradient: document.getElementById('windGradient'),
            windGradient3000: document.getElementById('windGradient3000'),
            windStatus: document.getElementById('windStatus'),
            // Thermik
            temp2m: document.getElementById('temp2m'),
            dewpoint: document.getElementById('dewpoint'),
            spread: document.getElementById('spread'),
            cape: document.getElementById('cape'),
            liftedIndex: document.getElementById('liftedIndex'),
            thermikStatus: document.getElementById('thermikStatus'),
            // Wolken
            cloudTotal: document.getElementById('cloudTotal'),
            cloudLow: document.getElementById('cloudLow'),
            cloudMid: document.getElementById('cloudMid'),
            cloudHigh: document.getElementById('cloudHigh'),
            visibility: document.getElementById('visibility'),
            cloudStatus: document.getElementById('cloudStatus'),
            // Niederschlag
            precip: document.getElementById('precip'),
            convPrecip: document.getElementById('convPrecip'),
            precipProb: document.getElementById('precipProb'),
            thunderRisk: document.getElementById('thunderRisk'),
            precipStatus: document.getElementById('precipStatus'),
            // Höhen-Info
            cloudBase: document.getElementById('cloudBase'),
            boundaryLayer: document.getElementById('boundaryLayer'),
            freezingLevel: document.getElementById('freezingLevel'),
            stationElevation: document.getElementById('stationElevation'),
            cloudBaseSummary: document.getElementById('cloudBaseSummary'),
            boundaryLayerSummary: document.getElementById('boundaryLayerSummary'),
            freezingLevelSummary: document.getElementById('freezingLevelSummary'),
            stationElevationSummary: document.getElementById('stationElevationSummary'),
            // Sonstiges
            weatherDesc: document.getElementById('weatherDesc'),
            currentTemp: document.getElementById('currentTemp'),
            // Windrose
            windArrowSurface: document.getElementById('windArrowSurface'),
            windArrow850: document.getElementById('windArrow850'),
            windArrow700: document.getElementById('windArrow700'),
            windroseSurface: document.getElementById('windroseSurface'),
            windrose850: document.getElementById('windrose850'),
            windrose700: document.getElementById('windrose700'),
            windroseShearWarning: document.getElementById('windroseShearWarning')
        };
    }
    return domCache;
}

/**
 * Formats value for display, shows "N/A" for missing data
 * @param {*} value - Value to display
 * @param {string} unit - Unit (e.g., 'km/h', '°C')
 * @param {number} decimals - Decimal places (default: 0)
 * @returns {string} Formatted string
 */
export function formatValue(value, unit = '', decimals = 0) {
    if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
        return '<span class="no-data">N/A</span>';
    }
    const formatted = typeof value === 'number' ? value.toFixed(decimals) : value;
    return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Tages-Auswahl setup
 */
export function setupDays() {
    state.forecastDays = [];
    const times = state.hourlyData.time;
    const uniqueDays = [...new Set(times.map(t => t.split('T')[0]))].slice(0, 3);

    uniqueDays.forEach((dayStr) => {
        const indices = [];
        times.forEach((t, i) => { if (t.startsWith(dayStr)) indices.push(i); });

        let worst = 3, windScore = 3, thermikScore = 3, cloudScore = 3, precipScore = 3;
        const h = state.hourlyData;

        indices.forEach(i => {
            const hour = new Date(times[i]).getHours();
            if (hour >= 8 && hour <= 18) {
                const s = getHourScore(i);
                if (s < worst) worst = s;

                // Kategorie-Scores berechnen (schlechtester Wert zählt)
                const ws = h.wind_speed_10m[i] || 0;
                const wg = h.wind_gusts_10m[i] || 0;
                const w850 = h.wind_speed_850hPa?.[i] || 0;
                const w800 = h.wind_speed_800hPa?.[i] || 0;
                const w700 = h.wind_speed_700hPa?.[i] || 0;
                const grad = Math.abs((h.wind_speed_850hPa?.[i] || 0) - (h.wind_speed_10m[i] || 0));
                const grad3000 = Math.abs((h.wind_speed_700hPa?.[i] || 0) - (h.wind_speed_10m[i] || 0));  // Gradient Boden-3000m
                const wScore = evaluateWind(ws, wg, w850, w800, w700, grad, grad3000);
                if (wScore < windScore) windScore = wScore;

                const temp = h.temperature_2m[i];
                const dew = h.dew_point_2m[i];
                const spread = (temp != null && dew != null) ? temp - dew : 10;
                const cape = h.cape?.[i] || 0;
                const li = h.lifted_index?.[i] || 0;
                const tScore = evaluateThermik(spread, cape, li);
                if (tScore < thermikScore) thermikScore = tScore;

                const ct = h.cloud_cover?.[i] || 0;
                const cl = h.cloud_cover_low?.[i] || 0;
                const vis = h.visibility?.[i] || 50000;
                // FIX: Mit spread und ws für intelligente Nebel-Erkennung
                const cScore = evaluateClouds(ct, cl, vis, spread, ws);
                if (cScore < cloudScore) cloudScore = cScore;

                const prec = h.precipitation?.[i] || 0;
                const pp = h.precipitation_probability?.[i] || 0;
                const showers = h.showers?.[i] || 0;
                const pScore = evaluatePrecip(prec, pp, cape, showers);
                if (pScore < precipScore) precipScore = pScore;
            }
        });

        state.forecastDays.push({
            date: dayStr,
            indices,
            worstScore: worst,
            windScore,
            thermikScore,
            cloudScore,
            precipScore
        });
    });

    buildDayComparison();
}

/**
 * Berechnet Tages-Ampel basierend auf Option A:
 * - GO: ≥3h grünes Fenster
 * - VORSICHT: 1-2h grünes Fenster ODER keine roten Stunden
 * - NO-GO: Kein grünes Fenster UND mindestens eine rote Stunde
 */
function getDayTrafficLight(dayStr) {
    const bestWin = findBestWindow(dayStr);
    const greenDuration = bestWin ? (bestWin.end - bestWin.start + 1) : 0;

    // Prüfe ob es rote Stunden gibt (6-20 Uhr)
    let hasRedHour = false;
    for (let h = 6; h <= 20; h++) {
        const ts = dayStr + 'T' + h.toString().padStart(2, '0') + ':00';
        const idx = state.hourlyData.time.findIndex(t => t === ts);
        if (idx !== -1 && getHourScore(idx) === 1) {
            hasRedHour = true;
            break;
        }
    }

    if (greenDuration >= 3) {
        return { status: 'go', label: 'GO' };
    } else if (greenDuration >= 1 || !hasRedHour) {
        return { status: 'caution', label: 'VORSICHT' };
    } else {
        return { status: 'nogo', label: 'NO-GO' };
    }
}

/**
 * Tages-Auswahl bauen (mit Ampel und Zeitfenster)
 */
export function buildDayComparison() {
    const grid = document.getElementById('dayComparisonGrid');
    grid.innerHTML = '';

    // Besten Tag ermitteln (Tag mit längstem grünen Fenster)
    let bestDayIdx = -1;
    let longestWindow = 0;
    state.forecastDays.forEach((day, i) => {
        const win = findBestWindow(day.date);
        if (win) {
            const duration = win.end - win.start;
            if (duration > longestWindow) {
                longestWindow = duration;
                bestDayIdx = i;
            }
        }
    });

    state.forecastDays.forEach((day, i) => {
        const d = new Date(day.date);
        const names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
        const name = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : names[d.getDay()];
        const bestWin = findBestWindow(day.date);
        const hasGreenWindow = bestWin !== null;
        const winText = bestWin ? (bestWin.start + '-' + bestWin.end + 'h') : '—';
        const isBest = i === bestDayIdx && hasGreenWindow;
        const trafficLight = getDayTrafficLight(day.date);

        const card = document.createElement('div');
        card.className = 'day-comparison-card' + (i === state.selectedDay ? ' active' : '') + (isBest ? ' best' : '');
        card.dataset.dayIdx = i;
        card.innerHTML = `
            <div class="day-comparison-date">${name} ${d.getDate()}.${d.getMonth() + 1}.</div>
            <span class="day-comparison-status ${trafficLight.status}">${trafficLight.label}</span>
            <div class="day-comparison-window ${hasGreenWindow ? 'go' : ''}">${winText}</div>`;
        grid.appendChild(card);
    });
}

/**
 * Tag auswählen
 */
export function selectDay(idx) {
    state.selectedDay = idx;
    document.querySelectorAll('.day-comparison-card').forEach((c, i) => c.classList.toggle('active', i === idx));
    updateSunTimes(idx);
    updateForecastConfidence(idx);
    buildTimeline(state.forecastDays[idx].date);

    // Wind-Profil aktualisieren wenn es geöffnet ist
    const windProfileWrapper = document.getElementById('windProfileWrapper');
    if (windProfileWrapper?.classList.contains('visible')) {
        renderWindDiagram(state.forecastDays[idx].date);
    }

    const now = new Date(), ch = now.getHours();
    let def = state.forecastDays[idx].indices.find(i => new Date(state.hourlyData.time[i]).getHours() === (idx === 0 ? ch : 12));
    if (!def) def = state.forecastDays[idx].indices.find(i => new Date(state.hourlyData.time[i]).getHours() === 12) || state.forecastDays[idx].indices[Math.floor(state.forecastDays[idx].indices.length / 2)];
    selectHour(def);
}

/**
 * PHASE 3 Aufgabe 3: Prognose-Sicherheit
 */
export function updateForecastConfidence(dayIdx) {
    const starsEl = document.getElementById('confidenceStars');
    const configs = [
        { stars: '⭐⭐⭐', class: 'high', label: 'hoch' },
        { stars: '⭐⭐☆', class: 'medium', label: 'mittel' },
        { stars: '⭐☆☆', class: 'low', label: 'gering' }
    ];
    const config = configs[Math.min(dayIdx, 2)];
    starsEl.textContent = config.stars;
    starsEl.className = 'stars ' + config.class;
}

/**
 * v8 NEU: Timeline mit Wetter-Symbolen
 * PHASE 1 SAFETY: Konditioniertes Zeitfenster
 */
export function buildTimeline(dayStr) {
    const tl = document.getElementById('timeline');
    tl.innerHTML = '';
    const bestWin = findBestWindow(dayStr);

    // Best-Window Banner ausblenden (Info wird in Tages-Karten angezeigt)
    const bwEl = document.getElementById('bestWindow');
    if (bwEl) bwEl.classList.remove('visible', 'yellow');

    for (let h = 6; h <= 20; h++) {
        const ts = dayStr + 'T' + h.toString().padStart(2, '0') + ':00';
        const idx = state.hourlyData.time.findIndex(t => t === ts);
        if (idx === -1) continue;

        const sc = getHourScore(idx);
        const slot = document.createElement('div');
        slot.className = 'timeline-slot ' + scoreToColor(sc);
        slot.dataset.hourIdx = idx;
        if (idx === state.selectedHourIndex) slot.classList.add('active');
        // Bestes Fenster markieren (grüne Stunden)
        if (bestWin && h >= bestWin.start && h <= bestWin.end && sc === 3) {
            slot.classList.add('best');
        }

        const weatherCode = state.hourlyData.weather_code?.[idx] || 0;
        const weatherInfo = getWeatherInfo(weatherCode);
        const isMobile = window.innerWidth < UI_CONFIG.mobileBreakpoint;
        const timeText = isMobile ? h : h + ':00';
        slot.innerHTML = `<div class="slot-time">${timeText}</div><div class="slot-weather">${weatherInfo.icon}</div>`;
        tl.appendChild(slot);
    }
}

/**
 * Stunde auswählen
 */
export function selectHour(idx) {
    state.selectedHourIndex = idx;
    updateDisplay(idx);
    buildTimeline(state.forecastDays[state.selectedDay].date);

    // Wind-Profil aktualisieren wenn es geöffnet ist (um ausgewählte Stunde zu markieren)
    const windProfileWrapper = document.getElementById('windProfileWrapper');
    if (windProfileWrapper?.classList.contains('visible')) {
        renderWindDiagram(state.forecastDays[state.selectedDay].date);
    }
}

/**
 * v9: updateDisplay (750hPa entfernt)
 */
export function updateDisplay(i) {
    const h = state.hourlyData, pi = i > 0 ? i - 1 : null;
    const ws = validateValue(h.wind_speed_10m[i], 0), wg = validateValue(h.wind_gusts_10m[i], 0);
    const w850 = validateValue(h.wind_speed_850hPa?.[i], 0), w800 = validateValue(h.wind_speed_800hPa?.[i], 0);
    const w700 = validateValue(h.wind_speed_700hPa?.[i], 0);
    const wdSurface = validateValue(h.wind_direction_10m[i], 0);
    const wd850 = validateValue(h.wind_direction_850hPa?.[i], 0), wd800 = validateValue(h.wind_direction_800hPa?.[i], 0);
    const wd700 = validateValue(h.wind_direction_700hPa?.[i], 0);
    const grad = Math.abs(w850 - ws), grad3000 = Math.abs(w700 - ws);  // Beide Gradienten zu Boden
    const temp = validateValue(h.temperature_2m[i], null), dew = validateValue(h.dew_point_2m[i], null);
    const spread = (temp !== null && dew !== null) ? temp - dew : null;
    const cape = validateValue(h.cape?.[i], 0), li = validateValue(h.lifted_index?.[i], 0);
    const ct = validateValue(h.cloud_cover[i], 0), cl = validateValue(h.cloud_cover_low[i], 0);
    const cm = validateValue(h.cloud_cover_mid[i], 0), cloudHigh = validateValue(h.cloud_cover_high[i], 0);
    const vis = validateValue(h.visibility[i], 10000), prec = validateValue(h.precipitation[i], 0);
    const pp = validateValue(h.precipitation_probability[i], 0);
    const freezing = validateValue(h.freezing_level_height?.[i], 0), boundaryLayer = validateValue(h.boundary_layer_height?.[i], 0);
    const showers = validateValue(h.showers?.[i], 0), weatherCode = validateValue(h.weather_code?.[i], 0);
    const cloudBase = (temp !== null && dew !== null) ? calculateCloudBase(temp, dew, state.currentLocation.elevation) : null;

    const windSc = evaluateWind(ws, wg, w850, w800, w700, grad, grad3000);
    const thermSc = evaluateThermik(spread, cape, li);
    const cloudSc = evaluateClouds(ct, cl, vis, spread, ws);  // Mit intelligenter Nebel-Erkennung
    const precSc = evaluatePrecip(prec, pp, cape, showers);

    // Filter anwenden: nur gefilterte Parameter in Bewertung einbeziehen
    const filter = state.paramFilter || { wind: true, thermik: true, clouds: true, precip: true };
    const scores = [];
    if (filter.wind) scores.push(windSc);
    if (filter.thermik) scores.push(thermSc);
    if (filter.clouds) scores.push(cloudSc);
    if (filter.precip) scores.push(precSc);
    const worst = scores.length > 0 ? Math.min(...scores) : 3;

    updateOverallAssessment(worst);

    // PHASE 2: Beginner-Badge und Risk-Explanation
    // Beginner-Badge NUR anzeigen wenn Gesamtstatus GO ist (worst === 3)
    const beginnerAssessment = worst === 3 ? calculateBeginnerSafety(i) : { isBeginner: false };
    renderBeginnerBadge(beginnerAssessment);

    // KISS: Risk-Explanation nur bei CAUTION, bei NO-GO reicht die Reason-Summary
    if (worst === 2) {
        const risks = getRiskExplanation(i, worst);
        renderRiskExplanation(risks);
    } else {
        renderRiskExplanation(null); // Ausblenden
    }

    // KISS: Killers-Section ausblenden - Reason-Summary zeigt bereits die kritischen Werte
    document.getElementById('killerWarnings')?.classList.remove('visible');
    updateReasonSummary(worst, ws, wg, w700, grad, cape, vis, spread, cl);
    updateWarnings(ws, wg, w850, w700, grad, spread, cape, li, cl, prec, vis, showers, freezing, boundaryLayer);
    updateWindrose(wdSurface, wd850, wd700, ws, w850, w700);

    // Höhen-Info (nutzt DOM-Cache)
    const dom = getDomCache();
    dom.cloudBase.textContent = cloudBase !== null ? cloudBase + ' m' : 'N/A';
    dom.boundaryLayer.textContent = Math.round(boundaryLayer) + ' m';
    dom.freezingLevel.textContent = Math.round(freezing) + ' m';
    dom.stationElevation.textContent = Math.round(state.currentLocation.elevation) + ' m';
    dom.cloudBaseSummary.textContent = cloudBase !== null ? cloudBase + 'm' : 'N/A';
    dom.boundaryLayerSummary.textContent = Math.round(boundaryLayer) + 'm';
    dom.freezingLevelSummary.textContent = Math.round(freezing) + 'm';
    dom.stationElevationSummary.textContent = Math.round(state.currentLocation.elevation) + 'm';
    const weatherInfo = getWeatherInfo(weatherCode);
    dom.weatherDesc.textContent = weatherInfo.icon + ' ' + weatherInfo.text;
    dom.currentTemp.textContent = temp !== null ? Math.round(temp) + '°C' : '-';

    // Trends (750hPa entfernt)
    const wt = getTrend(ws, pi !== null ? h.wind_speed_10m[pi] : null);
    const gt = getTrend(wg, pi !== null ? h.wind_gusts_10m[pi] : null);
    const t850 = getTrend(w850, pi !== null ? h.wind_speed_850hPa?.[pi] : null);
    const t800 = getTrend(w800, pi !== null ? h.wind_speed_800hPa?.[pi] : null);
    const t700 = getTrend(w700, pi !== null ? h.wind_speed_700hPa?.[pi] : null);
    const ct2 = getTrend(cape, pi !== null ? h.cape?.[pi] : null);

    // Wind-Werte
    document.getElementById('windSurface').innerHTML = Math.round(ws) + ' km/h <span class="trend ' + wt.cls + '">' + wt.symbol + '</span>';
    document.getElementById('windSurface').className = 'param-value ' + getColorClass(ws, LIMITS.wind.surface);
    document.getElementById('windDirSurface').textContent = Math.round(wdSurface) + '° ' + getWindDir(wdSurface);
    document.getElementById('windGusts').innerHTML = Math.round(wg) + ' km/h <span class="trend ' + gt.cls + '">' + gt.symbol + '</span>';
    document.getElementById('windGusts').className = 'param-value ' + getColorClass(wg, LIMITS.wind.gusts);

    // gustSpread (Böigkeit - Differenz zwischen Böen und Grundwind)
    const gustSpread = wg - ws;
    document.getElementById('gustSpread').textContent = Math.round(gustSpread) + ' km/h';
    document.getElementById('gustSpread').className = 'param-value ' + getColorClass(gustSpread, LIMITS.wind.gustSpread);
    document.getElementById('wind850').innerHTML = Math.round(w850) + ' km/h <span class="trend ' + t850.cls + '">' + t850.symbol + '</span>';
    document.getElementById('wind850').className = 'param-value ' + getColorClass(w850, LIMITS.wind.w850);
    document.getElementById('windDir850').textContent = Math.round(wd850) + '° ' + getWindDir(wd850);
    document.getElementById('wind800').innerHTML = Math.round(w800) + ' km/h <span class="trend ' + t800.cls + '">' + t800.symbol + '</span>';
    document.getElementById('wind800').className = 'param-value ' + getColorClass(w800, LIMITS.wind.w800);
    document.getElementById('windDir800').textContent = Math.round(wd800) + '° ' + getWindDir(wd800);
    // 750hPa entfernt - nicht zuverlässig verfügbar
    document.getElementById('wind700').innerHTML = Math.round(w700) + ' km/h <span class="trend ' + t700.cls + '">' + t700.symbol + '</span>';
    document.getElementById('wind700').className = 'param-value ' + getColorClass(w700, LIMITS.wind.w700);
    document.getElementById('windDir700').textContent = Math.round(wd700) + '° ' + getWindDir(wd700);
    document.getElementById('windGradient').textContent = Math.round(grad) + ' km/h';
    document.getElementById('windGradient').className = 'param-value ' + getColorClass(grad, LIMITS.wind.gradient);
    document.getElementById('windGradient3000').textContent = Math.round(grad3000) + ' km/h';
    document.getElementById('windGradient3000').className = 'param-value ' + getColorClass(grad3000, LIMITS.wind.gradient3000);
    document.getElementById('windStatus').className = 'param-status ' + scoreToColor(windSc);

    // Thermik-Werte (null-safe)
    document.getElementById('temp2m').textContent = temp !== null ? temp.toFixed(1) + '°C' : 'N/A';
    document.getElementById('dewpoint').textContent = dew !== null ? dew.toFixed(1) + '°C' : 'N/A';
    document.getElementById('spread').textContent = spread !== null ? spread.toFixed(1) + '°C' : 'N/A';
    document.getElementById('spread').className = 'param-value ' + getSpreadColor(spread);
    document.getElementById('cape').innerHTML = Math.round(cape) + ' J/kg <span class="trend ' + ct2.cls + '">' + ct2.symbol + '</span>';
    document.getElementById('cape').className = 'param-value ' + getColorClass(cape, LIMITS.cape);
    document.getElementById('liftedIndex').textContent = li.toFixed(1);
    document.getElementById('liftedIndex').className = 'param-value ' + (li < -4 ? 'red' : li < -2 ? 'yellow' : 'green');
    document.getElementById('thermikStatus').className = 'param-status ' + scoreToColor(thermSc);

    // Wolken-Werte (niedrigere Bewölkung ist besser, daher getColorClass)
    document.getElementById('cloudTotal').textContent = ct + '%';
    document.getElementById('cloudTotal').className = 'param-value ' + getColorClass(ct, LIMITS.clouds.total);
    document.getElementById('cloudLow').textContent = cl + '%';
    document.getElementById('cloudLow').className = 'param-value ' + getColorClass(cl, LIMITS.clouds.low);
    document.getElementById('cloudMid').textContent = cm + '%';
    document.getElementById('cloudHigh').textContent = cloudHigh + '%';
    document.getElementById('visibility').textContent = (vis / 1000).toFixed(1) + ' km';
    document.getElementById('visibility').className = 'param-value ' + getColorClassRev(vis, LIMITS.visibility);
    document.getElementById('cloudStatus').className = 'param-status ' + scoreToColor(cloudSc);

    // Niederschlag-Werte
    document.getElementById('precip').textContent = prec.toFixed(1) + ' mm';
    document.getElementById('precip').className = 'param-value ' + (prec < 0.1 ? 'green' : prec < 1 ? 'yellow' : 'red');
    document.getElementById('convPrecip').textContent = showers.toFixed(1) + ' mm';
    document.getElementById('convPrecip').className = 'param-value ' + (showers < 0.1 ? 'green' : showers < 0.5 ? 'yellow' : 'red');
    document.getElementById('precipProb').textContent = pp + '%';
    document.getElementById('precipProb').className = 'param-value ' + (pp < 20 ? 'green' : pp < 50 ? 'yellow' : 'red');
    const tr = cape > LIMITS.cape.yellow ? 'Hoch ⛈️' : cape > LIMITS.cape.green ? 'Moderat ⚠️' : 'Gering ✓';
    document.getElementById('thunderRisk').textContent = tr;
    document.getElementById('thunderRisk').className = 'param-value ' + getColorClass(cape, LIMITS.cape);
    document.getElementById('precipStatus').className = 'param-status ' + scoreToColor(precSc);

    autoExpandRedCards();
}

// Bewertungsfunktionen werden jetzt aus weather.js importiert (Single Source of Truth)

function updateOverallAssessment(sc) {
    const el = document.getElementById('assessmentStatus');
    const ic = document.getElementById('statusIcon');
    const tx = document.getElementById('statusText');
    el.className = 'assessment-status';

    if (sc === 3) {
        el.classList.add('go');
        ic.textContent = '✓';
        tx.textContent = 'GO';
    } else if (sc === 2) {
        el.classList.add('caution');
        ic.textContent = '⚠';
        tx.textContent = 'VORSICHT';
    } else {
        el.classList.add('nogo');
        ic.textContent = '✗';
        tx.textContent = 'NO-GO';
    }
}

// PHASE 1 SAFETY: Kurzfassung (mit Filter-Support)
function updateReasonSummary(score, ws, wg, w700, grad, cape, vis, spread, cloudLow) {
    const el = document.getElementById('reasonSummary'), textEl = document.getElementById('reasonText');
    el.className = 'reason-summary';
    const gustSpread = wg - ws; // Böen-Differenz
    const fogRisk = getFogRisk(spread || 10, ws, vis); // Intelligente Nebel-Erkennung
    const filter = state.paramFilter || { wind: true, thermik: true, clouds: true, precip: true };

    // Prüfen ob Filter aktiv ist (nicht alle Parameter ausgewählt)
    const filterActive = !filter.wind || !filter.thermik || !filter.clouds || !filter.precip;
    const filterHint = filterActive ? ' <span class="filter-hint">(Filter aktiv)</span>' : '';

    if (score === 3) {
        el.classList.add('go');
        textEl.innerHTML = '✓ <strong>Alle Parameter im sicheren Bereich.</strong>' + filterHint + ' Gute Bedingungen für einen Flug – dennoch vor Ort die Verhältnisse prüfen.';
    } else if (score === 1) {
        el.classList.add('nogo');
        const criticals = [];
        const inAlps = isInAlpineRegion(state.currentLocation.lat, state.currentLocation.lon);
        // Thermik-Filter
        if (filter.thermik && cape > LIMITS.cape.yellow) criticals.push({ name: 'CAPE', value: Math.round(cape) + ' J/kg', issue: 'Gewittergefahr' });
        // Wind-Filter
        if (filter.wind) {
            if (w700 > LIMITS.wind.w700.yellow) criticals.push({ name: 'Höhenwind', value: Math.round(w700) + ' km/h', issue: inAlps ? 'Föhngefahr' : 'zu stark' });
            if (wg > LIMITS.wind.gusts.yellow) criticals.push({ name: 'Böen', value: Math.round(wg) + ' km/h', issue: 'zu stark' });
            if (gustSpread > LIMITS.wind.gustSpread.yellow) criticals.push({ name: 'Böigkeit', value: Math.round(gustSpread) + ' km/h', issue: 'unruhig' });
            if (grad > LIMITS.wind.gradient.yellow) criticals.push({ name: 'Gradient', value: Math.round(grad) + ' km/h', issue: 'Windscherung' });
        }
        // Wolken-Filter (Nebel gehört zu Wolken/Sicht)
        if (filter.clouds && fogRisk === 'severe') {
            if (vis < LIMITS.fog.visibilitySevere) {
                criticals.push({ name: 'Sicht', value: (vis/1000).toFixed(1) + ' km', issue: 'kritisch' });
            } else {
                criticals.push({ name: 'Nebel', value: 'Spread ' + (spread?.toFixed(1) || '?') + '°C', issue: 'hohe Nebelgefahr' });
            }
        }

        if (criticals.length > 0) {
            const main = criticals.slice(0, 2);
            textEl.innerHTML = '✗ <strong>Nicht fliegbar wegen:</strong> ' + main.map(c => '<span class="reason-param red">' + c.name + ' ' + c.value + '</span> (' + c.issue + ')').join(', ') + filterHint;
        } else {
            textEl.innerHTML = '✗ <strong>Mehrere Parameter im kritischen Bereich.</strong>' + filterHint + ' Siehe Warnungen unten.';
        }
    } else {
        el.classList.add('caution');
        const elevated = [];
        // Wind-Filter
        if (filter.wind) {
            if (wg > LIMITS.wind.gusts.green) elevated.push({ name: 'Böen', value: Math.round(wg) + ' km/h' });
            if (gustSpread > LIMITS.wind.gustSpread.green) elevated.push({ name: 'Böigkeit', value: Math.round(gustSpread) + ' km/h Differenz' });
            if (w700 > LIMITS.wind.w700.green) elevated.push({ name: 'Höhenwind', value: Math.round(w700) + ' km/h' });
            if (ws > LIMITS.wind.surface.green) elevated.push({ name: 'Bodenwind', value: Math.round(ws) + ' km/h' });
            if (grad > LIMITS.wind.gradient.green) elevated.push({ name: 'Gradient', value: Math.round(grad) + ' km/h' });
        }
        // Thermik-Filter
        if (filter.thermik && cape > LIMITS.cape.green) elevated.push({ name: 'CAPE', value: Math.round(cape) + ' J/kg' });
        // Wolken-Filter
        if (filter.clouds) {
            if (cloudLow > LIMITS.clouds.low.green) elevated.push({ name: 'Tiefe Wolken', value: cloudLow + '%' });
            if (fogRisk === 'likely' || fogRisk === 'possible') {
                elevated.push({ name: 'Nebelrisiko', value: 'Webcam prüfen' });
            }
        }

        if (elevated.length > 0) {
            const main = elevated.slice(0, 2);
            textEl.innerHTML = '⚠ <strong>Hauptgrund:</strong> ' + main.map(e => '<span class="reason-param yellow">' + e.name + ' ' + e.value + '</span>').join(' und ') + '.' + filterHint + ' Erhöhte Aufmerksamkeit nötig.';
        } else {
            textEl.innerHTML = '⚠ <strong>Einige Parameter leicht erhöht.</strong>' + filterHint + ' Siehe gelbe Hinweise unten.';
        }
    }
}

// Warnungen aktualisieren
function updateWarnings(ws, wg, w850, w700, grad, spread, cape, li, cloudLow, precip, vis, showers, freezing, boundaryLayer) {
    const warnings = [];
    const gustFactor = getGustFactor(ws, wg);

    if (ws > LIMITS.wind.surface.yellow) warnings.push({ level: 'red', text: '💨 Bodenwind zu stark (' + Math.round(ws) + ' km/h)' });
    else if (ws > LIMITS.wind.surface.green) warnings.push({ level: 'yellow', text: '💨 Bodenwind erhöht (' + Math.round(ws) + ' km/h)' });

    if (wg > LIMITS.wind.gusts.yellow) {
        warnings.push({ level: 'red', text: '💨 Böen gefährlich stark (' + Math.round(wg) + ' km/h)' });
    } else if (wg > LIMITS.wind.gusts.green) {
        warnings.push({ level: 'yellow', text: '💨 Böen erhöht (' + Math.round(wg) + ' km/h)' });
    }

    // gustSpread (Böen-Differenz) - aussagekräftiger als gustFactor
    const gustSpread = wg - ws;
    if (gustSpread > LIMITS.wind.gustSpread.yellow) {
        warnings.push({ level: 'red', text: '💨 Stark böig – Differenz ' + Math.round(gustSpread) + ' km/h zwischen Böen und Grundwind' });
    } else if (gustSpread > LIMITS.wind.gustSpread.green) {
        warnings.push({ level: 'yellow', text: '💨 Böigkeit erhöht – Differenz ' + Math.round(gustSpread) + ' km/h' });
    }

    if (w700 <= LIMITS.wind.w700.yellow && w700 > LIMITS.wind.w700.green) {
        warnings.push({ level: 'yellow', text: '🌬️ Höhenwind erhöht (' + Math.round(w700) + ' km/h)' });
    }

    if (grad <= LIMITS.wind.gradient.yellow && grad > LIMITS.wind.gradient.green) {
        warnings.push({ level: 'yellow', text: '📊 Gradient erhöht (' + Math.round(grad) + ' km/h)' });
    }

    if (cape <= LIMITS.cape.yellow && cape > LIMITS.cape.green) {
        warnings.push({ level: 'yellow', text: '🌤️ CAPE erhöht (' + Math.round(cape) + ' J/kg)' });
    }

    if (li < LIMITS.liftedIndex.yellow) warnings.push({ level: 'red', text: '⚡ Lifted Index ' + li.toFixed(1) + ' – stark labil' });
    else if (li < LIMITS.liftedIndex.green) warnings.push({ level: 'yellow', text: '⚡ Lifted Index ' + li.toFixed(1) + ' – labil' });

    if (cloudLow > LIMITS.clouds.low.yellow) warnings.push({ level: 'red', text: '☁️ Tiefe Bewölkung ' + cloudLow + '%' });
    else if (cloudLow > LIMITS.clouds.low.green) warnings.push({ level: 'yellow', text: '☁️ Tiefe Bewölkung ' + cloudLow + '%' });

    // Intelligente Nebel/Sicht-Warnung (kombiniert Spread, Wind, Sichtweite)
    const fogRisk = getFogRisk(spread || 10, ws, vis);
    if (fogRisk === 'severe') {
        if (vis < LIMITS.fog.visibilitySevere) {
            warnings.push({ level: 'red', text: '🌫️ Kritische Sicht (' + (vis/1000).toFixed(1) + ' km) – VFR nicht möglich' });
        } else {
            warnings.push({ level: 'red', text: '🌫️ Hohe Nebelgefahr – Spread nur ' + (spread?.toFixed(1) || '?') + '°C bei wenig Wind' });
        }
    } else if (fogRisk === 'likely') {
        warnings.push({ level: 'yellow', text: '🌁 Nebel wahrscheinlich – Webcams prüfen! (Spread ' + (spread?.toFixed(1) || '?') + '°C)' });
    } else if (fogRisk === 'possible') {
        if (vis < LIMITS.fog.visibilityWarning) {
            warnings.push({ level: 'yellow', text: '🌫️ Sicht eingeschränkt (' + (vis/1000).toFixed(1) + ' km)' });
        } else if (spread !== null && spread < LIMITS.fog.spreadWarning) {
            warnings.push({ level: 'yellow', text: '💧 Hohe Luftfeuchtigkeit (Spread ' + spread.toFixed(1) + '°C) – lokale Nebelfelder möglich' });
        }
    }

    if (precip > LIMITS.precip.yellow) warnings.push({ level: 'red', text: '🌧️ Niederschlag ' + precip.toFixed(1) + ' mm' });
    else if (precip > LIMITS.precip.green) warnings.push({ level: 'yellow', text: '🌧️ Leichter Niederschlag möglich' });

    if (showers > LIMITS.showers.yellow) warnings.push({ level: 'red', text: '⛈️ Schauer erwartet (' + showers.toFixed(1) + ' mm)' });
    else if (showers > LIMITS.showers.green) warnings.push({ level: 'yellow', text: '🌦️ Lokale Schauer möglich' });

    if (freezing < METEO_CONSTANTS.freezingLevelWarning) warnings.push({ level: 'yellow', text: '❄️ Nullgradgrenze niedrig (' + Math.round(freezing) + 'm)' });
    if (boundaryLayer < METEO_CONSTANTS.boundaryLayerWarning) warnings.push({ level: 'yellow', text: '📉 Grenzschicht nur ' + Math.round(boundaryLayer) + 'm – schwache Thermik' });

    const el = document.getElementById('warnings'), list = document.getElementById('warningsList');
    if (warnings.length) {
        el.classList.add('visible');
        list.innerHTML = warnings.map(w => '<div class="warning-item ' + w.level + '">' + w.text + '</div>').join('');
    } else {
        el.classList.remove('visible');
    }
}

// Windrose aktualisieren (nutzt DOM-Cache für Performance)
function updateWindrose(wdSurface, wd850, wd700, wsSurface, ws850, ws700) {
    const dom = getDomCache();

    dom.windArrowSurface.style.transform = 'translate(-50%, -100%) rotate(' + wdSurface + 'deg)';
    dom.windArrow850.style.transform = 'translate(-50%, -100%) rotate(' + wd850 + 'deg)';
    dom.windArrow700.style.transform = 'translate(-50%, -100%) rotate(' + wd700 + 'deg)';
    dom.windroseSurface.textContent = Math.round(wsSurface) + ' km/h ' + getWindDir(wdSurface);
    dom.windrose850.textContent = Math.round(ws850) + ' km/h ' + getWindDir(wd850);
    dom.windrose700.textContent = Math.round(ws700) + ' km/h ' + getWindDir(wd700);

    const diff1 = Math.abs(wdSurface - wd850), norm1 = diff1 > 180 ? 360 - diff1 : diff1;
    const diff2 = Math.abs(wdSurface - wd700), norm2 = diff2 > 180 ? 360 - diff2 : diff2;
    if ((norm1 > 45 && ws850 > 15) || (norm2 > 60 && ws700 > 20)) {
        dom.windroseShearWarning.classList.add('visible');
    } else {
        dom.windroseShearWarning.classList.remove('visible');
    }
}

// PHASE 2: Theme-Funktionen
export function getPreferredTheme() {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME);
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
}

export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    setTheme(current === 'light' ? 'dark' : 'light');
}

// PHASE 2: Akkordeon-Funktionen
export function toggleParamCard(card, event) {
    if (event && event.target && event.target.closest('.tooltip-container')) return;
    card.classList.toggle('collapsed');
    card.classList.toggle('expanded');
}

export function expandAllCards() {
    document.querySelectorAll('.params-grid .param-card[data-card]').forEach(card => {
        card.classList.remove('collapsed');
        card.classList.add('expanded');
    });
}

export function collapseAllCards() {
    document.querySelectorAll('.params-grid .param-card[data-card]').forEach(card => {
        card.classList.add('collapsed');
        card.classList.remove('expanded');
    });
}

export function autoExpandRedCards() {
    document.querySelectorAll('.params-grid .param-card[data-card]').forEach(card => {
        const status = card.querySelector('.param-status');
        if (status && status.classList.contains('red')) {
            card.classList.remove('collapsed');
            card.classList.add('expanded');
        }
    });
}

// PHASE 2: Windrose Toggle
export function toggleWindroseVisibility() {
    const wrapper = document.getElementById('windroseWrapper');
    const toggle = document.getElementById('windroseToggle');
    const show = !wrapper.classList.contains('visible');
    wrapper.classList.toggle('visible', show);
    toggle.classList.toggle('active', show);
    localStorage.setItem(STORAGE_KEYS.WINDROSE, show.toString());
}

export function loadWindroseState() {
    const show = localStorage.getItem(STORAGE_KEYS.WINDROSE) === 'true';
    const wrapper = document.getElementById('windroseWrapper');
    const toggle = document.getElementById('windroseToggle');
    if (wrapper) wrapper.classList.toggle('visible', show);
    if (toggle) toggle.classList.toggle('active', show);
}

// PHASE 2: Höhen-Box Toggle
export function toggleHeightCard() {
    const card = document.getElementById('heightCard');
    card.classList.toggle('collapsed');
    card.classList.toggle('expanded');
    localStorage.setItem(STORAGE_KEYS.HEIGHT, card.classList.contains('expanded').toString());
}

export function loadHeightCardState() {
    // Höhen-Info startet immer collapsed (wie andere Param-Cards)
    const card = document.getElementById('heightCard');
    if (card) {
        card.classList.add('collapsed');
        card.classList.remove('expanded');
    }
}

// PHASE 2: Erklärung Toggle
export function toggleExplanation() {
    const c = document.getElementById('explanationContent'), i = document.getElementById('toggleIcon');
    c.classList.toggle('open');
    i.classList.toggle('open');
    if (c.classList.contains('open')) {
        const intro = document.getElementById('explanationIntro');
        const grid = document.querySelector('.explanation-grid');
        const footer = document.getElementById('explanationFooter');
        if (intro) intro.style.display = '';
        if (grid) grid.style.display = '';
        if (footer) footer.style.display = '';
    }
}

// Quick Explain
export function showQuickExplanation() {
    const content = document.getElementById('explanationContent');
    content.classList.add('open');
    document.getElementById('toggleIcon').classList.add('open');
    document.getElementById('killerExplainSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * PHASE 2: Rendert Beginner-Badge wenn Bedingungen perfekt sind
 * @param {Object} assessment - Beginner assessment from weather.js
 */
export function renderBeginnerBadge(assessment) {
    const container = document.getElementById('beginnerBadge');
    if (!container) return;

    if (!assessment || !assessment.isBeginner) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = `
        <div class="badge-content">
            <svg class="badge-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                      fill="currentColor" stroke="currentColor" stroke-width="2"/>
            </svg>
            <div class="badge-text">
                <strong>Anfänger-freundlich</strong>
                <small>Sanfte & sichere Bedingungen</small>
            </div>
        </div>
    `;
}

/**
 * PHASE 2: Rendert Risiko-Erklärungen bei Gelb/Rot
 * @param {Array} risks - Risk objects from weather.js
 */
export function renderRiskExplanation(risks) {
    const container = document.getElementById('riskExplanation');
    if (!container) return;

    if (!risks || risks.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    const risksHTML = risks.map(risk => `
        <div class="risk-item risk-${risk.severity}">
            <div class="risk-header">
                <span class="risk-icon">${risk.icon}</span>
                <h4 class="risk-title">${risk.title}</h4>
            </div>
            <p class="risk-description">${risk.description}</p>
            <p class="risk-advice"><strong>→</strong> ${risk.advice}</p>
        </div>
    `).join('');

    container.innerHTML = `
        <h3 class="risk-heading">
            <span class="heading-icon">🔍</span>
            Warum diese Warnung?
        </h3>
        <div class="risk-list">
            ${risksHTML}
        </div>
        <p class="risk-footer">
            <small>💡 Diese Analyse basiert auf Modelldaten. Prüfe zusätzlich lokale Bedingungen und Webcams.</small>
        </p>
    `;
}

// === Parameter-Filter Funktionen ===

/**
 * Lädt den Parameter-Filter aus localStorage
 */
export function loadParamFilter() {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.PARAM_FILTER);
        if (saved) {
            const parsed = JSON.parse(saved);
            state.paramFilter = {
                wind: parsed.wind !== false,
                thermik: parsed.thermik !== false,
                clouds: parsed.clouds !== false,
                precip: parsed.precip !== false
            };
        }
    } catch (e) {
        console.warn('Fehler beim Laden des Parameter-Filters:', e);
    }
    updateFilterUI();
    // Verzögert ausführen, damit DOM bereit ist
    setTimeout(updateFilterOptionStyles, 0);
}

/**
 * Aktualisiert die Checkbox-Option Styles (für Browser ohne :has() Support)
 */
function updateFilterOptionStyles() {
    const options = document.querySelectorAll('.param-filter-option');
    options.forEach(option => {
        const checkbox = option.querySelector('input[type="checkbox"]');
        if (checkbox) {
            option.classList.toggle('checked', checkbox.checked);
            option.classList.toggle('unchecked', !checkbox.checked);
        }
    });
}

/**
 * Speichert den Parameter-Filter in localStorage
 */
function saveParamFilter() {
    try {
        localStorage.setItem(STORAGE_KEYS.PARAM_FILTER, JSON.stringify(state.paramFilter));
    } catch (e) {
        console.warn('Fehler beim Speichern des Parameter-Filters:', e);
    }
}

/**
 * Aktualisiert die Filter-UI basierend auf dem State
 */
function updateFilterUI() {
    const filterWind = document.getElementById('filterWind');
    const filterThermik = document.getElementById('filterThermik');
    const filterClouds = document.getElementById('filterClouds');
    const filterPrecip = document.getElementById('filterPrecip');
    const summary = document.getElementById('paramFilterSummary');
    const card = document.querySelector('.param-filter-card');

    if (filterWind) filterWind.checked = state.paramFilter.wind;
    if (filterThermik) filterThermik.checked = state.paramFilter.thermik;
    if (filterClouds) filterClouds.checked = state.paramFilter.clouds;
    if (filterPrecip) filterPrecip.checked = state.paramFilter.precip;

    // Summary aktualisieren
    const activeFilters = [];
    if (state.paramFilter.wind) activeFilters.push('Wind');
    if (state.paramFilter.thermik) activeFilters.push('Thermik');
    if (state.paramFilter.clouds) activeFilters.push('Sicht');
    if (state.paramFilter.precip) activeFilters.push('Niederschlag');

    const allActive = activeFilters.length === 4;
    const noneActive = activeFilters.length === 0;

    if (summary) {
        if (allActive) {
            summary.textContent = 'Alle Parameter';
            summary.classList.remove('filtered');
        } else if (noneActive) {
            summary.textContent = 'Keine ausgewählt';
            summary.classList.add('filtered');
        } else {
            summary.textContent = activeFilters.join(', ');
            summary.classList.add('filtered');
        }
    }

    // Karte hervorheben wenn gefiltert
    if (card) {
        card.classList.toggle('has-filter', !allActive);
    }
}

/**
 * Handler für Filter-Änderungen
 */
export function handleFilterChange() {
    const filterWind = document.getElementById('filterWind');
    const filterThermik = document.getElementById('filterThermik');
    const filterClouds = document.getElementById('filterClouds');
    const filterPrecip = document.getElementById('filterPrecip');

    state.paramFilter.wind = filterWind?.checked ?? true;
    state.paramFilter.thermik = filterThermik?.checked ?? true;
    state.paramFilter.clouds = filterClouds?.checked ?? true;
    state.paramFilter.precip = filterPrecip?.checked ?? true;

    saveParamFilter();
    updateFilterUI();
    updateFilterOptionStyles();

    // Anzeige aktualisieren wenn Daten vorhanden
    if (state.hourlyData && state.selectedHourIndex !== null && state.forecastDays?.length > 0) {
        updateDisplay(state.selectedHourIndex);
        if (state.forecastDays[state.selectedDay]) {
            buildTimeline(state.forecastDays[state.selectedDay].date);
            buildDayComparison();
        }
    }
}

/**
 * Setzt alle Filter zurück (alle aktivieren)
 */
export function resetParamFilter() {
    state.paramFilter = {
        wind: true,
        thermik: true,
        clouds: true,
        precip: true
    };
    saveParamFilter();
    updateFilterUI();
    updateFilterOptionStyles();

    // Anzeige aktualisieren wenn Daten vorhanden
    if (state.hourlyData && state.selectedHourIndex !== null && state.forecastDays?.length > 0) {
        updateDisplay(state.selectedHourIndex);
        if (state.forecastDays[state.selectedDay]) {
            buildTimeline(state.forecastDays[state.selectedDay].date);
            buildDayComparison();
        }
    }
}

/**
 * Toggle für Filter-Panel
 */
export function toggleParamFilter() {
    const card = document.querySelector('.param-filter-card');
    if (card) {
        card.classList.toggle('expanded');
    }
}

// === Phase 6: About-Modal Funktionen ===

/**
 * Öffnet das About-Modal
 */
export function openAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (modal) {
        modal.classList.add('visible');
        document.body.style.overflow = 'hidden';
        // Version aus APP_INFO setzen (wird in main.js importiert)
        const versionEl = document.getElementById('aboutVersion');
        if (versionEl && window.APP_VERSION) {
            versionEl.textContent = 'v' + window.APP_VERSION;
        }
    }
}

/**
 * Schließt das About-Modal
 */
export function closeAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (modal) {
        modal.classList.remove('visible');
        document.body.style.overflow = '';
    }
}

/**
 * Wechselt den aktiven Tab im About-Modal
 * @param {string} tabId - ID des Tabs ('about', 'features', 'limits')
 */
export function switchAboutTab(tabId) {
    // Tabs aktivieren/deaktivieren
    document.querySelectorAll('.about-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
    // Tab-Inhalte anzeigen/verbergen
    document.querySelectorAll('.about-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === 'tab-' + tabId);
    });
}

/**
 * Initialisiert Touch-Tooltips für Mobile-Geräte
 */
export function initTouchTooltips() {
    // Nur auf Touch-Geräten
    if (!('ontouchstart' in window)) return;

    let activeTooltip = null;

    document.addEventListener('touchstart', (e) => {
        const tooltipContainer = e.target.closest('.tooltip-container');

        if (tooltipContainer) {
            // Tooltip öffnen/schließen bei Tap
            e.preventDefault();

            if (activeTooltip === tooltipContainer) {
                // Gleicher Tooltip - schließen
                tooltipContainer.classList.remove('touch-active');
                activeTooltip = null;
            } else {
                // Anderen Tooltip schließen
                if (activeTooltip) {
                    activeTooltip.classList.remove('touch-active');
                }
                // Neuen Tooltip öffnen
                tooltipContainer.classList.add('touch-active');
                activeTooltip = tooltipContainer;
            }
        } else if (activeTooltip) {
            // Außerhalb getippt - Tooltip schließen
            activeTooltip.classList.remove('touch-active');
            activeTooltip = null;
        }
    }, { passive: false });
}

// === Phase 7: Wind-Höhenprofil Diagramm ===

/**
 * Gibt die Farbklasse basierend auf Windgeschwindigkeit zurück
 * @param {number} speed - Windgeschwindigkeit in km/h
 * @param {string} level - Höhenlevel ('ground', '850', '800', '700')
 * @returns {string} CSS-Klasse ('green', 'yellow', 'red', 'calm')
 */
function getWindArrowColor(speed, level) {
    if (speed < 3) return 'calm';

    // Unterschiedliche Grenzwerte je nach Höhe
    const limits = {
        ground: { green: 12, yellow: 18 },
        '850': { green: 18, yellow: 28 },
        '800': { green: 22, yellow: 30 },
        '700': { green: 25, yellow: 30 }
    };

    const l = limits[level] || limits.ground;
    if (speed <= l.green) return 'green';
    if (speed <= l.yellow) return 'yellow';
    return 'red';
}

/**
 * Rendert das Wind-Höhenprofil für einen Tag
 * @param {string} dayStr - Datum im Format 'YYYY-MM-DD'
 */
export function renderWindDiagram(dayStr) {
    const grid = document.getElementById('windProfileGrid');
    const xAxis = document.getElementById('windProfileXAxis');
    if (!grid || !state.hourlyData) return;

    grid.innerHTML = '';
    xAxis.innerHTML = '';

    const h = state.hourlyData;
    const times = h.time;

    // Höhenlevel von oben nach unten (700hPa = 3000m ist oben)
    const levels = [
        { key: '700', speedKey: 'wind_speed_700hPa', dirKey: 'wind_direction_700hPa', label: '3000m' },
        { key: '800', speedKey: 'wind_speed_800hPa', dirKey: 'wind_direction_800hPa', label: '2000m' },
        { key: '850', speedKey: 'wind_speed_850hPa', dirKey: 'wind_direction_850hPa', label: '1500m' },
        { key: 'ground', speedKey: 'wind_speed_10m', dirKey: 'wind_direction_10m', label: 'Boden' }
    ];

    // Stunden von 6-20 Uhr (15 Stunden)
    const hours = [];
    for (let hour = 6; hour <= 20; hour++) {
        const ts = dayStr + 'T' + hour.toString().padStart(2, '0') + ':00';
        const idx = times.findIndex(t => t === ts);
        hours.push({ hour, idx });
    }

    // Grid aufbauen (4 Zeilen × 15 Spalten)
    levels.forEach(level => {
        hours.forEach(({ hour, idx }) => {
            const cell = document.createElement('div');
            cell.className = 'wind-cell';

            if (idx === -1) {
                // Keine Daten für diese Stunde (Zeitpunkt nicht im Datensatz)
                cell.innerHTML = '<span class="wind-no-data">—</span>';
                cell.setAttribute('data-tooltip', 'Keine Daten');
                grid.appendChild(cell);
                return;
            }

            // Prüfe ob Daten wirklich vorhanden sind
            const speedData = h[level.speedKey]?.[idx];
            const dirData = h[level.dirKey]?.[idx];
            const hasData = speedData !== null && speedData !== undefined && !isNaN(speedData);

            if (!hasData) {
                // Höhenwinde nicht verfügbar für diesen Zeitpunkt
                cell.innerHTML = '<span class="wind-no-data">—</span>';
                cell.setAttribute('data-tooltip', 'Nicht verfügbar');
                cell.classList.add('no-data');
                grid.appendChild(cell);
                return;
            }

            const speed = speedData;
            const dir = dirData ?? 0;
            const colorClass = getWindArrowColor(speed, level.key);
            const dirText = getWindDir(dir);

            // Tooltip mit Details
            cell.setAttribute('data-tooltip', `${Math.round(speed)} km/h ${dirText}`);

            // Markiere ausgewählte Stunde
            if (idx === state.selectedHourIndex) {
                cell.classList.add('selected');
            }

            // Klick-Handler um Stunde auszuwählen
            cell.dataset.hourIdx = idx;
            cell.style.cursor = 'pointer';
            cell.addEventListener('click', () => {
                selectHour(idx);
            });

            // Bei sehr schwachem Wind: Kreis statt Pfeil
            if (speed < 3) {
                const calm = document.createElement('div');
                calm.className = 'wind-calm';
                calm.innerHTML = '○';
                cell.appendChild(calm);
            } else {
                // Wind-Pfeil erstellen
                const arrow = document.createElement('div');
                arrow.className = `wind-arrow ${colorClass}`;
                // Pfeil zeigt in Windrichtung (woher der Wind kommt)
                arrow.style.transform = `rotate(${dir}deg)`;
                cell.appendChild(arrow);
            }

            grid.appendChild(cell);
        });
    });

    // X-Achsen-Labels
    hours.forEach(({ hour }) => {
        const label = document.createElement('span');
        label.className = 'x-label';
        label.textContent = hour;
        xAxis.appendChild(label);
    });
}

/**
 * Toggle Wind-Profil erweitern/zuklappen
 */
export function toggleWindDiagram() {
    const wrapper = document.getElementById('windProfileWrapper');
    const toggle = document.getElementById('windProfileToggle');
    if (!wrapper || !toggle) return;

    const show = !wrapper.classList.contains('visible');
    wrapper.classList.toggle('visible', show);
    toggle.classList.toggle('active', show);

    // Bei Öffnen: Diagramm rendern
    if (show && state.forecastDays?.[state.selectedDay]) {
        renderWindDiagram(state.forecastDays[state.selectedDay].date);
    }

    // Zustand speichern
    localStorage.setItem(STORAGE_KEYS.WIND_DIAGRAM, show.toString());
}

/**
 * Lädt den Zustand des Wind-Profils aus localStorage
 */
export function loadWindDiagramState() {
    const wrapper = document.getElementById('windProfileWrapper');
    const toggle = document.getElementById('windProfileToggle');
    if (wrapper && toggle) {
        const show = localStorage.getItem(STORAGE_KEYS.WIND_DIAGRAM) === 'true';
        wrapper.classList.toggle('visible', show);
        toggle.classList.toggle('active', show);
    }
}
