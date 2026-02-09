/**
 * SkyCheck - UI-Modul
 * DOM-Updates, Rendering, Darstellungs-Logik
 * v9 - Mit formatValue für sichere Anzeige
 */

import { state } from './state.js';
import { LIMITS, STORAGE_KEYS, UI_CONFIG, METEO_CONSTANTS, APP_INFO } from './config.js';
import {
    getWindDir, getColorClass, getColorClassRev, getSpreadColor,
    scoreToColor, getTrend, getGustFactor, getWeatherInfo, isInAlpineRegion,
    escapeHtml, validateCustomLimits, formatAge
} from './utils.js';
import {
    getHourScore, findBestWindow, updateSunTimes, calculateCloudBase, validateValue,
    calculateBeginnerSafety, getRiskExplanation, getFogRisk, extractWindData,
    getEffectiveLimits,
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
            wind900: document.getElementById('wind900'),
            windDir900: document.getElementById('windDir900'),
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
            // Nebelrisiko
            fogRisk: document.getElementById('fogRisk'),
            // Höhen-Info (verteilt auf Thermik-Box und Location-Card)
            cloudBase: document.getElementById('cloudBase'),
            boundaryLayer: document.getElementById('boundaryLayer'),
            freezingLevel: document.getElementById('freezingLevel'),
            stationElevation: document.getElementById('stationElevation'),
            // Sonstiges
            weatherDesc: document.getElementById('weatherDesc'),
            currentTemp: document.getElementById('currentTemp'),
            // Windrose
            windArrowSurface: document.getElementById('windArrowSurface'),
            windArrow900: document.getElementById('windArrow900'),
            windArrow850: document.getElementById('windArrow850'),
            windArrow700: document.getElementById('windArrow700'),
            windroseSurface: document.getElementById('windroseSurface'),
            windrose900: document.getElementById('windrose900'),
            windrose850: document.getElementById('windrose850'),
            windrose700: document.getElementById('windrose700'),
            windroseShearWarning: document.getElementById('windroseShearWarning')
        };
    }
    return domCache;
}

/**
 * Formatiert Wert für Anzeige, zeigt "N/A" bei fehlenden Daten
 * @param {*} value - Anzuzeigender Wert
 * @param {string} unit - Einheit (z.B. 'km/h', '°C')
 * @param {number} decimals - Dezimalstellen (Standard: 0)
 * @returns {string} Formatierter String
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
                const wind = extractWindData(h, i);
                const { ws, wg, w900, w850, w800, w700, grad, grad3000 } = wind;
                const wScore = evaluateWind(ws, wg, w900, w850, w800, w700, grad, grad3000);
                if (wScore < windScore) windScore = wScore;

                const temp = h.temperature_2m?.[i];
                const dew = h.dew_point_2m?.[i];
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

    // Wind-Profil immer aktualisieren (ist jetzt immer sichtbar)
    renderWindDiagram(state.forecastDays[idx].date);

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

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentHour = now.getHours();
    const isToday = dayStr === todayStr;

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
        // Aktuelle Stunde markieren (nur heute)
        if (isToday && h === currentHour) {
            slot.classList.add('now');
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

    // Wind-Profil aktualisieren (um ausgewählte Stunde zu markieren)
    renderWindDiagram(state.forecastDays[state.selectedDay].date);
}

/**
 * v9: updateDisplay (750hPa entfernt)
 */
export function updateDisplay(i) {
    const h = state.hourlyData, pi = i > 0 ? i - 1 : null;
    const ws = validateValue(h.wind_speed_10m[i], 0), wg = validateValue(h.wind_gusts_10m[i], 0);
    const w900 = validateValue(h.wind_speed_900hPa?.[i], 0);
    const w850 = validateValue(h.wind_speed_850hPa?.[i], 0), w800 = validateValue(h.wind_speed_800hPa?.[i], 0);
    const w700 = validateValue(h.wind_speed_700hPa?.[i], 0);
    const wdSurface = validateValue(h.wind_direction_10m[i], 0);
    const wd900 = validateValue(h.wind_direction_900hPa?.[i], 0);
    const wd850 = validateValue(h.wind_direction_850hPa?.[i], 0), wd800 = validateValue(h.wind_direction_800hPa?.[i], 0);
    const wd700 = validateValue(h.wind_direction_700hPa?.[i], 0);
    const grad = Math.abs(w850 - ws), grad3000 = Math.abs(w700 - ws);  // Beide Gradienten zu Boden
    const temp = validateValue(h.temperature_2m?.[i], null), dew = validateValue(h.dew_point_2m?.[i], null);
    const spread = (temp !== null && dew !== null) ? temp - dew : null;
    const cape = validateValue(h.cape?.[i], 0), li = validateValue(h.lifted_index?.[i], 0);
    const ct = validateValue(h.cloud_cover?.[i], 0), cl = validateValue(h.cloud_cover_low?.[i], 0);
    const cm = validateValue(h.cloud_cover_mid?.[i], 0), cloudHigh = validateValue(h.cloud_cover_high?.[i], 0);
    const vis = validateValue(h.visibility?.[i], 10000), prec = validateValue(h.precipitation?.[i], 0);
    const pp = validateValue(h.precipitation_probability?.[i], 0);
    const freezing = validateValue(h.freezing_level_height?.[i], 0), boundaryLayer = validateValue(h.boundary_layer_height?.[i], 0);
    const showers = validateValue(h.showers?.[i], 0), weatherCode = validateValue(h.weather_code?.[i], 0);
    const cloudBase = (temp !== null && dew !== null) ? calculateCloudBase(temp, dew, state.currentLocation.elevation) : null;

    const windSc = evaluateWind(ws, wg, w900, w850, w800, w700, grad, grad3000);
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

    // KISS: Risk-Explanation komplett ausblenden - Reason-Summary zeigt bereits Hauptgrund + weitere Hinweise
    renderRiskExplanation(null);

    // KISS: Killers-Section ausblenden - Reason-Summary zeigt bereits die kritischen Werte
    document.getElementById('killerWarnings')?.classList.remove('visible');
    updateReasonSummary(worst, ws, wg, w900, w850, w800, w700, grad, grad3000, cape, vis, spread, cl, ct, li, prec, pp, showers);
    updateWindrose(wdSurface, wd900, wd850, wd700, ws, w900, w850, w700);

    // Höhen-Info (nutzt DOM-Cache) - verteilt auf Thermik-Box und Location-Card
    const dom = getDomCache();
    dom.cloudBase.textContent = cloudBase !== null ? cloudBase + ' m' : 'N/A';
    dom.boundaryLayer.textContent = boundaryLayer > 0 ? Math.round(boundaryLayer) + ' m' : 'n.v.';
    dom.freezingLevel.textContent = Math.round(freezing) + ' m';
    dom.stationElevation.textContent = Math.round(state.currentLocation.elevation) + ' m';
    const weatherInfo = getWeatherInfo(weatherCode);
    dom.weatherDesc.textContent = weatherInfo.icon + ' ' + weatherInfo.text;
    dom.currentTemp.textContent = temp !== null ? Math.round(temp) + '°C' : '-';

    // Trends (750hPa entfernt)
    const wt = getTrend(ws, pi !== null ? h.wind_speed_10m[pi] : null);
    const gt = getTrend(wg, pi !== null ? h.wind_gusts_10m[pi] : null);
    const t900 = getTrend(w900, pi !== null ? h.wind_speed_900hPa?.[pi] : null);
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
    // 900hPa (~1000m) - typische Flughöhe Hügel/Mittelgebirge
    document.getElementById('wind900').innerHTML = Math.round(w900) + ' km/h <span class="trend ' + t900.cls + '">' + t900.symbol + '</span>';
    document.getElementById('wind900').className = 'param-value ' + getColorClass(w900, LIMITS.wind.w900);
    document.getElementById('windDir900').textContent = Math.round(wd900) + '° ' + getWindDir(wd900);
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

    // Nebelrisiko anzeigen (basiert auf Spread, Wind, Sichtweite)
    const fogRiskLevel = getFogRisk(spread || 10, ws, vis);
    const fogRiskEl = document.getElementById('fogRisk');
    if (fogRiskEl) {
        const fogLabels = {
            'severe': { text: 'Hoch 🌫️', class: 'red' },
            'likely': { text: 'Wahrscheinlich ⚠️', class: 'yellow' },
            'possible': { text: 'Möglich', class: 'yellow' },
            'unlikely': { text: 'Gering ✓', class: 'green' }
        };
        const fog = fogLabels[fogRiskLevel] || fogLabels.unlikely;
        fogRiskEl.textContent = fog.text;
        fogRiskEl.className = 'param-value ' + fog.class;
    }

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

let lastAssessmentScore = null;

function updateOverallAssessment(sc) {
    const el = document.getElementById('assessmentStatus');
    const ic = document.getElementById('statusIcon');
    const tx = document.getElementById('statusText');
    const lightRed = document.getElementById('lightRed');
    const lightYellow = document.getElementById('lightYellow');
    const lightGreen = document.getElementById('lightGreen');

    // Prüfen ob Status sich geändert hat
    const statusChanged = lastAssessmentScore !== null && lastAssessmentScore !== sc;
    lastAssessmentScore = sc;

    el.className = 'assessment-status';

    // Alle Ampel-Lichter zurücksetzen
    lightRed.classList.remove('active');
    lightYellow.classList.remove('active');
    lightGreen.classList.remove('active');

    if (sc === 3) {
        el.classList.add('go');
        ic.textContent = '✓';
        tx.textContent = 'GO';
        lightGreen.classList.add('active');
    } else if (sc === 2) {
        el.classList.add('caution');
        ic.textContent = '⚠';
        tx.textContent = 'VORSICHT';
        lightYellow.classList.add('active');
    } else {
        el.classList.add('nogo');
        ic.textContent = '✗';
        tx.textContent = 'NO-GO';
        lightRed.classList.add('active');
    }

    // Pulse-Animation bei Statuswechsel
    if (statusChanged) {
        el.classList.add('pulse');
        setTimeout(() => el.classList.remove('pulse'), 400);
    }
}

// PHASE 1 SAFETY: Alle Hinweise in einer Liste (sortiert nach Schweregrad und Grenzwert-Abweichung)
function updateReasonSummary(score, ws, wg, w900, w850, w800, w700, grad, grad3000, cape, vis, spread, cloudLow, cloudTotal, li, precip, precipProb, showers) {
    const el = document.getElementById('reasonSummary'), textEl = document.getElementById('reasonText');
    el.className = 'reason-summary';
    const gustSpread = wg - ws;
    const gustFactor = ws > 0 ? (wg - ws) / ws : 0;
    const fogRisk = getFogRisk(spread || 10, ws, vis);
    const filter = state.paramFilter || { wind: true, thermik: true, clouds: true, precip: true };
    const filterActive = !filter.wind || !filter.thermik || !filter.clouds || !filter.precip;

    if (score === 3) {
        el.classList.add('go');
        const filterHint = filterActive ? ' <span class="filter-hint">(Filter aktiv)</span>' : '';
        textEl.innerHTML = '✓ <strong>Alle Parameter im grünen Bereich.</strong>' + filterHint + ' Gute Bedingungen – dennoch vor Ort prüfen.';
        return;
    }

    // Alle Hinweise sammeln mit Level und Abweichung vom Grenzwert
    const hints = [];

    // Helper: Abweichung berechnen (wie viel % über dem Grenzwert)
    const calcDeviation = (val, greenLimit, yellowLimit) => {
        if (val > yellowLimit) return ((val - yellowLimit) / yellowLimit) * 100 + 100;
        if (val > greenLimit) return ((val - greenLimit) / (yellowLimit - greenLimit)) * 100;
        return 0;
    };

    // Wind-Parameter
    if (filter.wind) {
        if (ws > LIMITS.wind.surface.yellow) {
            hints.push({ level: 'red', text: '💨 Bodenwind zu stark (' + Math.round(ws) + ' km/h)', deviation: calcDeviation(ws, LIMITS.wind.surface.green, LIMITS.wind.surface.yellow) });
        } else if (ws > LIMITS.wind.surface.green) {
            hints.push({ level: 'yellow', text: '💨 Bodenwind erhöht (' + Math.round(ws) + ' km/h)', deviation: calcDeviation(ws, LIMITS.wind.surface.green, LIMITS.wind.surface.yellow) });
        }

        if (wg > LIMITS.wind.gusts.yellow) {
            hints.push({ level: 'red', text: '💨 Böen gefährlich stark (' + Math.round(wg) + ' km/h)', deviation: calcDeviation(wg, LIMITS.wind.gusts.green, LIMITS.wind.gusts.yellow) });
        } else if (wg > LIMITS.wind.gusts.green) {
            hints.push({ level: 'yellow', text: '💨 Böen erhöht (' + Math.round(wg) + ' km/h)', deviation: calcDeviation(wg, LIMITS.wind.gusts.green, LIMITS.wind.gusts.yellow) });
        }

        if (gustSpread > LIMITS.wind.gustSpread.yellow) {
            hints.push({ level: 'red', text: '💨 Stark böig – Differenz ' + Math.round(gustSpread) + ' km/h', deviation: calcDeviation(gustSpread, LIMITS.wind.gustSpread.green, LIMITS.wind.gustSpread.yellow) });
        } else if (gustSpread > LIMITS.wind.gustSpread.green) {
            hints.push({ level: 'yellow', text: '💨 Böigkeit erhöht – Differenz ' + Math.round(gustSpread) + ' km/h', deviation: calcDeviation(gustSpread, LIMITS.wind.gustSpread.green, LIMITS.wind.gustSpread.yellow) });
        }

        // Höhenwinde auf verschiedenen Leveln
        if (w900 > LIMITS.wind.w900.yellow) {
            hints.push({ level: 'red', text: '🌬️ Wind 1000m kritisch (' + Math.round(w900) + ' km/h)', deviation: calcDeviation(w900, LIMITS.wind.w900.green, LIMITS.wind.w900.yellow) });
        } else if (w900 > LIMITS.wind.w900.green) {
            hints.push({ level: 'yellow', text: '🌬️ Wind 1000m erhöht (' + Math.round(w900) + ' km/h)', deviation: calcDeviation(w900, LIMITS.wind.w900.green, LIMITS.wind.w900.yellow) });
        }

        if (w850 > LIMITS.wind.w850.yellow) {
            hints.push({ level: 'red', text: '🌬️ Wind 1500m kritisch (' + Math.round(w850) + ' km/h)', deviation: calcDeviation(w850, LIMITS.wind.w850.green, LIMITS.wind.w850.yellow) });
        } else if (w850 > LIMITS.wind.w850.green) {
            hints.push({ level: 'yellow', text: '🌬️ Wind 1500m erhöht (' + Math.round(w850) + ' km/h)', deviation: calcDeviation(w850, LIMITS.wind.w850.green, LIMITS.wind.w850.yellow) });
        }

        if (w800 > LIMITS.wind.w800.yellow) {
            hints.push({ level: 'red', text: '🌬️ Wind 2000m kritisch (' + Math.round(w800) + ' km/h)', deviation: calcDeviation(w800, LIMITS.wind.w800.green, LIMITS.wind.w800.yellow) });
        } else if (w800 > LIMITS.wind.w800.green) {
            hints.push({ level: 'yellow', text: '🌬️ Wind 2000m erhöht (' + Math.round(w800) + ' km/h)', deviation: calcDeviation(w800, LIMITS.wind.w800.green, LIMITS.wind.w800.yellow) });
        }

        if (w700 > LIMITS.wind.w700.yellow) {
            hints.push({ level: 'red', text: '🌬️ Wind 3000m kritisch (' + Math.round(w700) + ' km/h)', deviation: calcDeviation(w700, LIMITS.wind.w700.green, LIMITS.wind.w700.yellow) });
        } else if (w700 > LIMITS.wind.w700.green) {
            hints.push({ level: 'yellow', text: '🌬️ Wind 3000m erhöht (' + Math.round(w700) + ' km/h)', deviation: calcDeviation(w700, LIMITS.wind.w700.green, LIMITS.wind.w700.yellow) });
        }

        if (grad > LIMITS.wind.gradient.yellow) {
            hints.push({ level: 'red', text: '📊 Gradient kritisch (' + Math.round(grad) + ' km/h)', deviation: calcDeviation(grad, LIMITS.wind.gradient.green, LIMITS.wind.gradient.yellow) });
        } else if (grad > LIMITS.wind.gradient.green) {
            hints.push({ level: 'yellow', text: '📊 Gradient erhöht (' + Math.round(grad) + ' km/h)', deviation: calcDeviation(grad, LIMITS.wind.gradient.green, LIMITS.wind.gradient.yellow) });
        }

        if (grad3000 > LIMITS.wind.gradient3000.yellow) {
            hints.push({ level: 'red', text: '📊 Gradient 3000m kritisch (' + Math.round(grad3000) + ' km/h)', deviation: calcDeviation(grad3000, LIMITS.wind.gradient3000.green, LIMITS.wind.gradient3000.yellow) });
        } else if (grad3000 > LIMITS.wind.gradient3000.green) {
            hints.push({ level: 'yellow', text: '📊 Gradient 3000m erhöht (' + Math.round(grad3000) + ' km/h)', deviation: calcDeviation(grad3000, LIMITS.wind.gradient3000.green, LIMITS.wind.gradient3000.yellow) });
        }

        // Böenfaktor (nur wenn Böen stark genug)
        if (gustFactor > LIMITS.wind.gustFactor.yellow && wg > LIMITS.wind.gustFactorMinWind.yellow) {
            hints.push({ level: 'red', text: '💨 Böenfaktor kritisch (' + gustFactor.toFixed(1) + 'x)', deviation: 120 });
        } else if (gustFactor > LIMITS.wind.gustFactor.green && wg > LIMITS.wind.gustFactorMinWind.green) {
            hints.push({ level: 'yellow', text: '💨 Böenfaktor erhöht (' + gustFactor.toFixed(1) + 'x)', deviation: 60 });
        }
    }

    // Thermik-Parameter
    if (filter.thermik) {
        if (cape > LIMITS.cape.yellow) {
            hints.push({ level: 'red', text: '⚡ CAPE kritisch (' + Math.round(cape) + ' J/kg) – Gewittergefahr', deviation: calcDeviation(cape, LIMITS.cape.green, LIMITS.cape.yellow) });
        } else if (cape > LIMITS.cape.green) {
            hints.push({ level: 'yellow', text: '🌤️ CAPE erhöht (' + Math.round(cape) + ' J/kg)', deviation: calcDeviation(cape, LIMITS.cape.green, LIMITS.cape.yellow) });
        }

        if (li !== undefined && li !== null) {
            if (li < LIMITS.liftedIndex.yellow) {
                hints.push({ level: 'red', text: '⚡ Lifted Index ' + li.toFixed(1) + ' – stark labil', deviation: Math.abs(li - LIMITS.liftedIndex.yellow) * 20 + 100 });
            } else if (li < LIMITS.liftedIndex.green) {
                hints.push({ level: 'yellow', text: '⚡ Lifted Index ' + li.toFixed(1) + ' – labil', deviation: Math.abs(li - LIMITS.liftedIndex.green) * 20 });
            }
        }

        // Spread für Thermik-Qualität (zu trocken = schlechte Thermik)
        if (spread !== null && spread > LIMITS.spread.max) {
            hints.push({ level: 'yellow', text: '💧 Sehr trockene Luft (Spread ' + spread.toFixed(1) + '°C) – schwache Thermik', deviation: 30 });
        }
    }

    // Wolken/Sicht-Parameter
    if (filter.clouds) {
        if (fogRisk === 'severe') {
            if (vis < LIMITS.fog.visibilitySevere) {
                hints.push({ level: 'red', text: '🌫️ Kritische Sicht (' + (vis/1000).toFixed(1) + ' km)', deviation: 200 });
            } else {
                hints.push({ level: 'red', text: '🌫️ Hohe Nebelgefahr – Spread ' + (spread?.toFixed(1) || '?') + '°C', deviation: 150 });
            }
        } else if (fogRisk === 'likely') {
            hints.push({ level: 'yellow', text: '🌁 Nebel wahrscheinlich – Spread ' + (spread?.toFixed(1) || '?') + '°C', deviation: 80 });
        } else if (fogRisk === 'possible' && vis < LIMITS.fog.visibilityWarning) {
            hints.push({ level: 'yellow', text: '🌫️ Sicht eingeschränkt (' + (vis/1000).toFixed(1) + ' km)', deviation: 50 });
        }

        if (cloudLow > LIMITS.clouds.low.yellow) {
            hints.push({ level: 'red', text: '☁️ Tiefe Bewölkung ' + cloudLow + '%', deviation: calcDeviation(cloudLow, LIMITS.clouds.low.green, LIMITS.clouds.low.yellow) });
        } else if (cloudLow > LIMITS.clouds.low.green) {
            hints.push({ level: 'yellow', text: '☁️ Tiefe Bewölkung ' + cloudLow + '%', deviation: calcDeviation(cloudLow, LIMITS.clouds.low.green, LIMITS.clouds.low.yellow) });
        }

        if (cloudTotal > LIMITS.clouds.total.yellow) {
            hints.push({ level: 'red', text: '☁️ Starke Bewölkung ' + cloudTotal + '%', deviation: calcDeviation(cloudTotal, LIMITS.clouds.total.green, LIMITS.clouds.total.yellow) });
        } else if (cloudTotal > LIMITS.clouds.total.green) {
            hints.push({ level: 'yellow', text: '☁️ Bewölkung ' + cloudTotal + '%', deviation: calcDeviation(cloudTotal, LIMITS.clouds.total.green, LIMITS.clouds.total.yellow) });
        }
    }

    // Niederschlag
    if (filter.precip) {
        if (precip > LIMITS.precip.yellow) {
            hints.push({ level: 'red', text: '🌧️ Niederschlag ' + precip.toFixed(1) + ' mm', deviation: calcDeviation(precip, LIMITS.precip.green, LIMITS.precip.yellow) });
        } else if (precip > LIMITS.precip.green) {
            hints.push({ level: 'yellow', text: '🌧️ Leichter Niederschlag möglich', deviation: calcDeviation(precip, LIMITS.precip.green, LIMITS.precip.yellow) });
        }

        if (showers > LIMITS.showers.yellow) {
            hints.push({ level: 'red', text: '⛈️ Schauer erwartet (' + showers.toFixed(1) + ' mm)', deviation: calcDeviation(showers, LIMITS.showers.green, LIMITS.showers.yellow) });
        } else if (showers > LIMITS.showers.green) {
            hints.push({ level: 'yellow', text: '🌦️ Lokale Schauer möglich', deviation: calcDeviation(showers, LIMITS.showers.green, LIMITS.showers.yellow) });
        }

        if (precipProb > LIMITS.precipProb.yellow) {
            hints.push({ level: 'yellow', text: '🌧️ Regenwahrscheinlichkeit ' + Math.round(precipProb) + '%', deviation: precipProb - LIMITS.precipProb.yellow });
        }
    }

    // Sortieren: erst rot (level), dann nach deviation absteigend
    hints.sort((a, b) => {
        if (a.level === 'red' && b.level !== 'red') return -1;
        if (a.level !== 'red' && b.level === 'red') return 1;
        return b.deviation - a.deviation;
    });

    // Status-Klasse setzen
    el.classList.add(score === 1 ? 'nogo' : 'caution');

    // HTML generieren
    const filterHint = filterActive ? '<div class="filter-hint" style="margin-top: 0.5rem; font-size: 0.8rem;">(Filter aktiv)</div>' : '';
    textEl.innerHTML = '<div class="hints-list">' +
        hints.map(h => '<div class="hint-item ' + h.level + '">' + h.text + '</div>').join('') +
        '</div>' + filterHint;
}


// Windrose aktualisieren (nutzt DOM-Cache für Performance)
function updateWindrose(wdSurface, wd900, wd850, wd700, wsSurface, ws900, ws850, ws700) {
    const dom = getDomCache();

    dom.windArrowSurface.style.transform = 'translate(-50%, -100%) rotate(' + wdSurface + 'deg)';
    dom.windArrow900.style.transform = 'translate(-50%, -100%) rotate(' + wd900 + 'deg)';
    dom.windArrow850.style.transform = 'translate(-50%, -100%) rotate(' + wd850 + 'deg)';
    dom.windArrow700.style.transform = 'translate(-50%, -100%) rotate(' + wd700 + 'deg)';
    dom.windroseSurface.textContent = Math.round(wsSurface) + ' km/h ' + getWindDir(wdSurface);
    dom.windrose900.textContent = Math.round(ws900) + ' km/h ' + getWindDir(wd900);
    dom.windrose850.textContent = Math.round(ws850) + ' km/h ' + getWindDir(wd850);
    dom.windrose700.textContent = Math.round(ws700) + ' km/h ' + getWindDir(wd700);

    // Windscherung prüfen (inkl. 900hPa)
    const diff900 = Math.abs(wdSurface - wd900), norm900 = diff900 > 180 ? 360 - diff900 : diff900;
    const diff850 = Math.abs(wdSurface - wd850), norm850 = diff850 > 180 ? 360 - diff850 : diff850;
    const diff700 = Math.abs(wdSurface - wd700), norm700 = diff700 > 180 ? 360 - diff700 : diff700;
    if ((norm900 > 30 && ws900 > 12) || (norm850 > 45 && ws850 > 15) || (norm700 > 60 && ws700 > 20)) {
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
    // Nur gültige Themes erlauben (Injection-Schutz)
    const validThemes = ['light', 'dark'];
    const safeTheme = validThemes.includes(theme) ? theme : 'light';
    document.documentElement.setAttribute('data-theme', safeTheme);
    localStorage.setItem(STORAGE_KEYS.THEME, safeTheme);
    // Accessibility: aria-checked auf Theme-Toggle aktualisieren
    const toggle = document.getElementById('themeToggle');
    if (toggle) toggle.setAttribute('aria-checked', safeTheme === 'dark' ? 'true' : 'false');
}

export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    setTheme(current === 'light' ? 'dark' : 'light');
}

// High Contrast Mode (Standard = high)
export function loadContrastMode() {
    const saved = localStorage.getItem(STORAGE_KEYS.CONTRAST);
    // High Contrast ist Standard - nur deaktivieren wenn explizit 'normal' gespeichert
    if (saved !== 'normal') {
        document.documentElement.setAttribute('data-contrast', 'high');
    }
}

export function toggleContrastMode() {
    const current = document.documentElement.getAttribute('data-contrast');
    if (current === 'high') {
        document.documentElement.removeAttribute('data-contrast');
        localStorage.setItem(STORAGE_KEYS.CONTRAST, 'normal');  // Explizit speichern um Standard zu überschreiben
    } else {
        document.documentElement.setAttribute('data-contrast', 'high');
        localStorage.removeItem(STORAGE_KEYS.CONTRAST);  // Standard wiederherstellen
    }
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
 * @param {Object} assessment - Beginner-Bewertung aus weather.js
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
 * @param {Array} risks - Risiko-Objekte aus weather.js
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
    const validSeverities = ['red', 'yellow', 'green'];
    const risksHTML = risks.map(risk => {
        const safeSeverity = validSeverities.includes(risk.severity) ? risk.severity : 'yellow';
        return `
        <div class="risk-item risk-${safeSeverity}">
            <div class="risk-header">
                <span class="risk-icon">${escapeHtml(risk.icon || '')}</span>
                <h4 class="risk-title">${escapeHtml(risk.title || '')}</h4>
            </div>
            <p class="risk-description">${escapeHtml(risk.description || '')}</p>
            <p class="risk-advice"><strong>→</strong> ${escapeHtml(risk.advice || '')}</p>
        </div>
    `}).join('');

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

// === Expertenmodus Funktionen ===

/**
 * Lädt den Expertenmodus-Zustand aus localStorage
 */
export function loadExpertMode() {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.EXPERT_MODE);
        state.expertMode = saved === 'true';

        const customLimits = localStorage.getItem(STORAGE_KEYS.CUSTOM_LIMITS);
        if (customLimits) {
            const parsed = JSON.parse(customLimits);
            const validated = validateCustomLimits(parsed);
            if (validated) {
                state.customLimits = validated;
            } else {
                // Ungültige Daten entfernen
                localStorage.removeItem(STORAGE_KEYS.CUSTOM_LIMITS);
            }
        }

        updateExpertModeUI();
    } catch (e) {
        console.warn('Expertenmodus-Zustand konnte nicht geladen werden:', e);
    }
}

/**
 * Speichert den Expertenmodus-Zustand
 */
function saveExpertMode() {
    localStorage.setItem(STORAGE_KEYS.EXPERT_MODE, state.expertMode.toString());
    if (state.customLimits) {
        localStorage.setItem(STORAGE_KEYS.CUSTOM_LIMITS, JSON.stringify(state.customLimits));
    }
}

/**
 * Toggle für Expertenmodus
 */
export function toggleExpertMode() {
    state.expertMode = !state.expertMode;
    saveExpertMode();
    updateExpertModeUI();

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
 * UI für Expertenmodus aktualisieren
 */
function updateExpertModeUI() {
    const toggle = document.getElementById('expertModeToggle');
    const settingsBtn = document.getElementById('expertSettingsBtn');
    const section = document.querySelector('.expert-mode-section');
    const hint = document.getElementById('expertModeHint');

    if (toggle) toggle.checked = state.expertMode;
    if (settingsBtn) settingsBtn.disabled = !state.expertMode;
    if (section) section.classList.toggle('active', state.expertMode);

    if (hint) {
        if (!state.expertMode) {
            hint.textContent = 'Eigene Grenzwerte für die Ampel-Bewertung definieren';
            hint.classList.remove('active');
        } else if (state.customLimits) {
            // Zähle geänderte Parameter
            const changes = countCustomChanges();
            hint.innerHTML = `<strong>✓ ${changes} Parameter angepasst</strong>`;
            hint.classList.add('active');
        } else {
            hint.textContent = 'Klicke "Anpassen" um Grenzwerte zu setzen';
            hint.classList.remove('active');
        }
    }
}

/**
 * Zählt wie viele Parameter vom Standard abweichen
 */
function countCustomChanges() {
    if (!state.customLimits) return 0;
    let count = 0;

    // Wind
    if (state.customLimits.wind?.surface?.yellow !== LIMITS.wind.surface.yellow) count++;
    if (state.customLimits.wind?.gusts?.yellow !== LIMITS.wind.gusts.yellow) count++;
    if (state.customLimits.wind?.gustSpread?.yellow !== LIMITS.wind.gustSpread.yellow) count++;
    if (state.customLimits.wind?.gradient?.yellow !== LIMITS.wind.gradient.yellow) count++;
    if (state.customLimits.wind?.w850?.yellow !== LIMITS.wind.w850.yellow) count++;
    if (state.customLimits.wind?.w700?.yellow !== LIMITS.wind.w700.yellow) count++;

    // Thermik
    if (state.customLimits.cape?.yellow !== LIMITS.cape.yellow) count++;

    // Wolken
    if (state.customLimits.clouds?.low?.yellow !== LIMITS.clouds.low.yellow) count++;
    if (state.customLimits.visibility?.green !== LIMITS.visibility.green) count++;

    // Niederschlag
    if (state.customLimits.precip?.yellow !== LIMITS.precip.yellow) count++;
    if (state.customLimits.precipProb?.yellow !== LIMITS.precipProb.yellow) count++;

    return count;
}

/**
 * Öffnet das Expertenmodus-Einstellungen Modal
 */
export function openExpertSettings() {
    if (!state.expertMode) return;

    const modal = document.getElementById('expertModal');
    if (modal) {
        populateExpertForm();
        modal.classList.add('visible');
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Schließt das Expertenmodus-Einstellungen Modal
 */
export function closeExpertSettings() {
    const modal = document.getElementById('expertModal');
    if (modal) {
        modal.classList.remove('visible');
        document.body.style.overflow = '';
    }
}

/**
 * Füllt das Expertenmodus-Formular mit aktuellen Werten
 */
function populateExpertForm() {
    const currentLimits = state.customLimits || LIMITS;

    // Wind
    setInputValue('expertWindSurface', currentLimits.wind?.surface?.yellow, LIMITS.wind.surface.yellow);
    setInputValue('expertWindGusts', currentLimits.wind?.gusts?.yellow, LIMITS.wind.gusts.yellow);
    setInputValue('expertGustSpread', currentLimits.wind?.gustSpread?.yellow, LIMITS.wind.gustSpread.yellow);
    setInputValue('expertGradient', currentLimits.wind?.gradient?.yellow, LIMITS.wind.gradient.yellow);
    setInputValue('expertWind900', currentLimits.wind?.w900?.yellow, LIMITS.wind.w900.yellow);
    setInputValue('expertWind850', currentLimits.wind?.w850?.yellow, LIMITS.wind.w850.yellow);
    setInputValue('expertWind700', currentLimits.wind?.w700?.yellow, LIMITS.wind.w700.yellow);

    // Thermik
    setInputValue('expertCape', currentLimits.cape?.yellow, LIMITS.cape.yellow);

    // Wolken/Sicht
    setInputValue('expertCloudLow', currentLimits.clouds?.low?.yellow, LIMITS.clouds.low.yellow);
    setInputValue('expertVisibility', currentLimits.visibility?.green, LIMITS.visibility.green);

    // Niederschlag
    setInputValue('expertPrecip', currentLimits.precip?.yellow, LIMITS.precip.yellow);
    setInputValue('expertPrecipProb', currentLimits.precipProb?.yellow, LIMITS.precipProb.yellow);
}

function setInputValue(id, value, fallback) {
    const input = document.getElementById(id);
    if (input) {
        input.value = value ?? fallback;
        input.placeholder = fallback;
    }
}

/**
 * Berechnet Grün-Schwelle aus Gelb-Schwelle (ca. 66%)
 */
function calcGreenThreshold(yellow, defaultGreen, defaultYellow) {
    // Verhältnis aus Default beibehalten
    const ratio = defaultGreen / defaultYellow;
    return Math.round(yellow * ratio);
}

/**
 * Speichert die Expertenmodus-Einstellungen
 */
export function saveExpertSettings() {
    // Gelb-Schwellen aus Formular lesen
    const windSurfaceYellow = getInputNumber('expertWindSurface', LIMITS.wind.surface.yellow);
    const windGustsYellow = getInputNumber('expertWindGusts', LIMITS.wind.gusts.yellow);
    const gustSpreadYellow = getInputNumber('expertGustSpread', LIMITS.wind.gustSpread.yellow);
    const gradientYellow = getInputNumber('expertGradient', LIMITS.wind.gradient.yellow);
    const w900Yellow = getInputNumber('expertWind900', LIMITS.wind.w900.yellow);
    const w850Yellow = getInputNumber('expertWind850', LIMITS.wind.w850.yellow);
    const w700Yellow = getInputNumber('expertWind700', LIMITS.wind.w700.yellow);
    const capeYellow = getInputNumber('expertCape', LIMITS.cape.yellow);
    const cloudLowYellow = getInputNumber('expertCloudLow', LIMITS.clouds.low.yellow);
    const visibilityGreen = getInputNumber('expertVisibility', LIMITS.visibility.green);
    const precipYellow = getInputNumber('expertPrecip', LIMITS.precip.yellow);
    const precipProbYellow = getInputNumber('expertPrecipProb', LIMITS.precipProb.yellow);

    // Custom Limits mit automatisch berechneten Grün-Schwellen
    const customLimits = {
        wind: {
            surface: {
                yellow: windSurfaceYellow,
                green: calcGreenThreshold(windSurfaceYellow, LIMITS.wind.surface.green, LIMITS.wind.surface.yellow)
            },
            gusts: {
                yellow: windGustsYellow,
                green: calcGreenThreshold(windGustsYellow, LIMITS.wind.gusts.green, LIMITS.wind.gusts.yellow)
            },
            gustSpread: {
                yellow: gustSpreadYellow,
                green: calcGreenThreshold(gustSpreadYellow, LIMITS.wind.gustSpread.green, LIMITS.wind.gustSpread.yellow)
            },
            gradient: {
                yellow: gradientYellow,
                green: calcGreenThreshold(gradientYellow, LIMITS.wind.gradient.green, LIMITS.wind.gradient.yellow)
            },
            w900: {
                yellow: w900Yellow,
                green: calcGreenThreshold(w900Yellow, LIMITS.wind.w900.green, LIMITS.wind.w900.yellow)
            },
            w850: {
                yellow: w850Yellow,
                green: calcGreenThreshold(w850Yellow, LIMITS.wind.w850.green, LIMITS.wind.w850.yellow)
            },
            w700: {
                yellow: w700Yellow,
                green: calcGreenThreshold(w700Yellow, LIMITS.wind.w700.green, LIMITS.wind.w700.yellow)
            }
        },
        cape: {
            yellow: capeYellow,
            green: calcGreenThreshold(capeYellow, LIMITS.cape.green, LIMITS.cape.yellow)
        },
        clouds: {
            low: {
                yellow: cloudLowYellow,
                green: calcGreenThreshold(cloudLowYellow, LIMITS.clouds.low.green, LIMITS.clouds.low.yellow)
            }
        },
        visibility: {
            green: visibilityGreen,
            yellow: Math.round(visibilityGreen * 0.5)  // Gelb = 50% von Grün
        },
        precip: {
            yellow: precipYellow,
            green: Math.round(precipYellow * 0.1 * 10) / 10  // Grün = 10% von Gelb
        },
        precipProb: {
            yellow: precipProbYellow
        }
    };

    state.customLimits = customLimits;
    saveExpertMode();
    updateExpertModeUI();
    closeExpertSettings();

    // Anzeige aktualisieren
    if (state.hourlyData && state.selectedHourIndex !== null && state.forecastDays?.length > 0) {
        updateDisplay(state.selectedHourIndex);
        if (state.forecastDays[state.selectedDay]) {
            buildTimeline(state.forecastDays[state.selectedDay].date);
            buildDayComparison();
        }
    }
}

function getInputNumber(id, fallback) {
    const input = document.getElementById(id);
    if (!input) return fallback;
    const val = parseFloat(input.value);
    return isNaN(val) ? fallback : val;
}

/**
 * Setzt die Expertenmodus-Einstellungen auf Standardwerte zurück
 */
export function resetExpertSettings() {
    state.customLimits = null;
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_LIMITS);
    populateExpertForm();
    updateExpertModeUI();
    updatePresetButtons('standard');
}

/**
 * Preset-Profile für Expertenmodus
 */
const EXPERT_PRESETS = {
    beginner: {
        label: 'Anfänger',
        description: 'Konservative Limits für Flugschüler und Genussflieger',
        values: {
            windSurface: 12,
            windGusts: 18,
            gustSpread: 10,
            gradient: 12,
            w900: 18,
            w850: 20,
            w700: 22,
            cape: 500,
            cloudLow: 40,
            visibility: 15000,
            precip: 0.5,
            precipProb: 20
        }
    },
    standard: {
        label: 'Standard',
        description: 'Ausgewogene Limits für erfahrene Freizeitpiloten',
        values: {
            windSurface: LIMITS.wind.surface.yellow,
            windGusts: LIMITS.wind.gusts.yellow,
            gustSpread: LIMITS.wind.gustSpread.yellow,
            gradient: LIMITS.wind.gradient.yellow,
            w900: LIMITS.wind.w900.yellow,
            w850: LIMITS.wind.w850.yellow,
            w700: LIMITS.wind.w700.yellow,
            cape: LIMITS.cape.yellow,
            cloudLow: LIMITS.clouds.low.yellow,
            visibility: LIMITS.visibility.green,
            precip: LIMITS.precip.yellow,
            precipProb: LIMITS.precipProb.yellow
        }
    },
    pro: {
        label: 'Profi',
        description: 'Erweiterte Limits für erfahrene Piloten mit guter Ortskenntnis',
        values: {
            windSurface: 22,
            windGusts: 32,
            gustSpread: 18,
            gradient: 22,
            w900: 30,
            w850: 35,
            w700: 40,
            cape: 1500,
            cloudLow: 70,
            visibility: 8000,
            precip: 2,
            precipProb: 40
        }
    }
};

/**
 * Wendet ein Preset an
 */
export function applyExpertPreset(presetName) {
    const preset = EXPERT_PRESETS[presetName];
    if (!preset) return;

    // Werte in Formular eintragen
    setInputValue('expertWindSurface', preset.values.windSurface, LIMITS.wind.surface.yellow);
    setInputValue('expertWindGusts', preset.values.windGusts, LIMITS.wind.gusts.yellow);
    setInputValue('expertGustSpread', preset.values.gustSpread, LIMITS.wind.gustSpread.yellow);
    setInputValue('expertGradient', preset.values.gradient, LIMITS.wind.gradient.yellow);
    setInputValue('expertWind900', preset.values.w900, LIMITS.wind.w900.yellow);
    setInputValue('expertWind850', preset.values.w850, LIMITS.wind.w850.yellow);
    setInputValue('expertWind700', preset.values.w700, LIMITS.wind.w700.yellow);
    setInputValue('expertCape', preset.values.cape, LIMITS.cape.yellow);
    setInputValue('expertCloudLow', preset.values.cloudLow, LIMITS.clouds.low.yellow);
    setInputValue('expertVisibility', preset.values.visibility, LIMITS.visibility.green);
    setInputValue('expertPrecip', preset.values.precip, LIMITS.precip.yellow);
    setInputValue('expertPrecipProb', preset.values.precipProb, LIMITS.precipProb.yellow);

    updatePresetButtons(presetName);
}

/**
 * Aktualisiert die Preset-Button-Styles
 */
function updatePresetButtons(activePreset) {
    document.querySelectorAll('.expert-preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === activePreset);
    });
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
        // Version aus APP_INFO setzen
        const versionEl = document.getElementById('aboutVersion');
        if (versionEl) {
            versionEl.textContent = 'v' + APP_INFO.version;
        }
        // Email-Link zusammensetzen (gegen Spam-Bots verschleiert)
        const emailLink = document.getElementById('feedbackEmailLink');
        if (emailLink && APP_INFO.feedbackEmailParts) {
            const email = APP_INFO.feedbackEmailParts.join('@');
            emailLink.href = 'mailto:' + email;
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

// === Toast Notifications ===
let toastTimeout = null;

/**
 * Zeigt eine Toast-Benachrichtigung
 * @param {string} message - Nachricht
 * @param {string} type - 'success', 'warning', 'error' oder '' für neutral
 * @param {number} duration - Anzeigedauer in ms (default 3000)
 */
export function showToast(message, type = '', duration = 3000) {
    // Vorherigen Timeout IMMER abbrechen (Memory Leak verhindern)
    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }

    const toast = document.getElementById('toast');
    if (!toast) return;

    // Typ-Klassen zurücksetzen
    toast.classList.remove('success', 'warning', 'error', 'visible');

    // Nachricht setzen und anzeigen
    toast.textContent = message;
    if (type) toast.classList.add(type);

    // Kurze Verzögerung für CSS-Transition
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    // Nach Dauer ausblenden
    toastTimeout = setTimeout(() => {
        toast.classList.remove('visible');
    }, duration);
}

// === Pull-to-Refresh ===
let pullStartY = 0;
let isPulling = false;
let pullRefreshCallback = null;

export function initPullToRefresh(onRefresh) {
    pullRefreshCallback = onRefresh;
    const container = document.querySelector('.results-section');
    if (!container || !('ontouchstart' in window)) return;

    const indicator = document.createElement('div');
    indicator.className = 'pull-refresh-indicator';
    indicator.innerHTML = '<span class="pull-refresh-icon">↓</span><span class="pull-refresh-text">Ziehen zum Aktualisieren</span>';
    container.insertBefore(indicator, container.firstChild);

    container.addEventListener('touchstart', (e) => {
        if (container.scrollTop === 0) {
            pullStartY = e.touches[0].clientY;
            isPulling = true;
        }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (!isPulling) return;
        const pullDistance = e.touches[0].clientY - pullStartY;

        if (pullDistance > 0 && pullDistance < 150) {
            indicator.style.transform = `translateY(${Math.min(pullDistance - 50, 20)}px)`;
            indicator.style.opacity = Math.min(pullDistance / 80, 1);

            if (pullDistance > 80) {
                indicator.classList.add('ready');
                indicator.querySelector('.pull-refresh-text').textContent = 'Loslassen zum Aktualisieren';
            } else {
                indicator.classList.remove('ready');
                indicator.querySelector('.pull-refresh-text').textContent = 'Ziehen zum Aktualisieren';
            }
        }
    }, { passive: true });

    container.addEventListener('touchend', () => {
        if (!isPulling) return;
        isPulling = false;

        if (indicator.classList.contains('ready') && pullRefreshCallback) {
            indicator.classList.add('refreshing');
            indicator.querySelector('.pull-refresh-text').textContent = 'Aktualisiere...';
            // Promise.resolve() für den Fall, dass Callback kein Promise zurückgibt
            Promise.resolve(pullRefreshCallback())
                .catch(err => console.error('Refresh-Fehler:', err))
                .finally(() => {
                    indicator.classList.remove('refreshing', 'ready');
                    indicator.style.transform = '';
                    indicator.style.opacity = '0';
                });
        } else {
            indicator.classList.remove('ready');
            indicator.style.transform = '';
            indicator.style.opacity = '0';
        }
    }, { passive: true });
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

    // Limits aus Expert-Mode oder Default (konsistent mit Ampel-Bewertung)
    const L = getEffectiveLimits();
    const limits = {
        ground: { green: L.wind.surface.green, yellow: L.wind.surface.yellow },
        '900': { green: L.wind.w900.green, yellow: L.wind.w900.yellow },
        '850': { green: L.wind.w850.green, yellow: L.wind.w850.yellow },
        '800': { green: L.wind.w800.green, yellow: L.wind.w800.yellow },
        '700': { green: L.wind.w700.green, yellow: L.wind.w700.yellow }
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
        { key: '900', speedKey: 'wind_speed_900hPa', dirKey: 'wind_direction_900hPa', label: '1000m' },
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
                // Pfeil zeigt wohin der Wind weht (wie ein Pfeil der mit dem Wind fliegt)
                arrow.style.transform = `rotate(${(dir + 180) % 360}deg)`;
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
 * Live-Wind-Stationen rendern
 * Unterstützt OpenWindMap/Pioupiou und Lawinenwarndienst-Stationen
 * @param {Array} stations - Array von Stationen aus fetchNearbyLiveWind()
 */
export function renderLiveWindStations(stations) {
    const card = document.getElementById('liveWindCard');
    const container = document.getElementById('liveWindStations');
    const loadBtn = document.getElementById('liveWindLoadBtn');

    if (!card || !container) return;

    // Laden-Button verstecken
    if (loadBtn) loadBtn.style.display = 'none';

    // Keine Stationen gefunden
    if (!stations || stations.length === 0) {
        container.innerHTML = '<div class="live-wind-empty">Keine Stationen im Umkreis von 30 km gefunden</div>';
        return;
    }

    // Karte anzeigen
    card.style.display = 'block';

    // Stationen rendern
    container.innerHTML = stations.map(station => {
        // Windstärke-Farbe
        const windClass = station.windSpeed > 25 ? 'red' :
                          station.windSpeed > 15 ? 'yellow' : 'green';

        // Windpfeil-Rotation (Wind kommt AUS dieser Richtung, also + 180° für Pfeilspitze)
        const arrowRotation = station.windDirection !== null ?
            `transform: rotate(${station.windDirection + 180}deg)` : '';

        // Böen-Anzeige
        const gustHtml = station.windGust && station.windGust > station.windSpeed ?
            `<span class="station-gust">Böen: <span class="gust-value">${station.windGust}</span></span>` : '';

        // Stations-Link und -Badge je nach Quelle
        let stationLink, sourceBadge, sourceClass;
        if (station.source === 'lwd') {
            // Lawinenwarndienst - kein direkter Link, aber Operator anzeigen
            stationLink = `<span class="station-name">${escapeHtml(station.name)}</span>`;
            sourceBadge = `<span class="station-source lwd" title="${escapeHtml(station.operator)}">LWD</span>`;
            sourceClass = 'source-lwd';
        } else {
            // OpenWindMap/Pioupiou - Link zur Station
            const stationId = String(station.id).replace('piou-', '').replace(/[^a-zA-Z0-9_-]/g, '');
            const stationUrl = `https://www.pioupiou.fr/fr/stations/${stationId}`;
            stationLink = `<a href="${stationUrl}" target="_blank" rel="noopener noreferrer" class="station-name" title="${escapeHtml(station.name)} – auf OpenWindMap öffnen">${escapeHtml(station.name)} ↗</a>`;
            sourceBadge = `<span class="station-source owm" title="OpenWindMap">OWM</span>`;
            sourceClass = 'source-owm';
        }

        // Zusätzliche Infos (Höhe, Temperatur)
        let extraInfo = '';
        if (station.elevation) {
            extraInfo += `<span class="station-elevation">⛰️ ${station.elevation}m</span>`;
        }
        if (station.temperature !== null && station.temperature !== undefined) {
            extraInfo += `<span class="station-temp">🌡️ ${station.temperature}°C</span>`;
        }

        return `
            <div class="live-wind-station ${sourceClass}">
                <div class="station-info">
                    <div class="station-header">
                        ${stationLink}
                        ${sourceBadge}
                    </div>
                    <div class="station-meta">
                        <span class="station-distance">📍 ${station.distance} km</span>
                        ${extraInfo}
                        <span class="station-age">⏱️ ${formatAge(station.ageMinutes)}</span>
                    </div>
                </div>
                <div class="station-wind" data-dir="${escapeHtml(station.windDirectionText || '')}">
                    <span class="station-wind-value ${windClass}">${station.windSpeed !== null ? station.windSpeed : '-'}</span>
                    <span class="station-wind-unit">km/h</span>
                    ${gustHtml}
                </div>
                <div class="station-direction">
                    <div class="station-dir-arrow" style="${arrowRotation}">↑</div>
                    <span class="station-dir-text">${escapeHtml(station.windDirectionText || '-')}</span>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Zeigt Loading-State für Live-Wind
 */
export function showLiveWindLoading() {
    const card = document.getElementById('liveWindCard');
    const container = document.getElementById('liveWindStations');

    if (card && container) {
        card.style.display = 'block';
        container.innerHTML = `
            <div class="live-wind-loading">
                <div class="spinner"></div>
                <span>Suche Stationen...</span>
            </div>
        `;
    }
}

/**
 * Versteckt die Live-Wind-Karte
 */
export function hideLiveWindCard() {
    const card = document.getElementById('liveWindCard');
    if (card) {
        card.style.display = 'none';
    }
}

/**
 * Zeigt den Button zum Laden der Live-Wind-Daten
 */
export function showLiveWindButton() {
    const card = document.getElementById('liveWindCard');
    const container = document.getElementById('liveWindStations');
    const loadBtn = document.getElementById('liveWindLoadBtn');

    if (card) {
        card.style.display = 'block';
    }
    if (container) {
        container.innerHTML = '';
    }
    if (loadBtn) {
        loadBtn.style.display = 'flex';
    }
}

/**
 * Versteckt den Laden-Button (nach dem Klick)
 */
export function hideLiveWindButton() {
    const loadBtn = document.getElementById('liveWindLoadBtn');
    if (loadBtn) {
        loadBtn.style.display = 'none';
    }
}


