/**
 * SkyCheck - UI-Modul
 * DOM-Updates, Rendering, Darstellungs-Logik
 * v9 - Mit formatValue für sichere Anzeige
 */

import { state } from './state.js';
import { LIMITS, STORAGE_KEYS } from './config.js';
import {
    getWindDir, getColorClass, getColorClassRev, getSpreadColor,
    scoreToColor, getTrend, getGustFactor, getWeatherInfo, isInAlpineRegion
} from './utils.js';
import {
    getHourScore, findBestWindow, updateSunTimes, calculateCloudBase, validateValue,
    calculateBeginnerSafety, getRiskExplanation,
    // Zentralisierte Bewertungsfunktionen (Single Source of Truth)
    evaluateWind, evaluateThermik, evaluateClouds, evaluatePrecip
} from './weather.js';

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
                const cScore = evaluateClouds(ct, cl, vis);
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
        const isMobile = window.innerWidth < 500;
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
    const cloudSc = evaluateClouds(ct, cl, vis);
    const precSc = evaluatePrecip(prec, pp, cape, showers);
    const worst = Math.min(windSc, thermSc, cloudSc, precSc);

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

    // v8 NEU: Höhen-Info (null-safe)
    document.getElementById('cloudBase').textContent = cloudBase !== null ? cloudBase + ' m' : 'N/A';
    document.getElementById('boundaryLayer').textContent = Math.round(boundaryLayer) + ' m';
    document.getElementById('freezingLevel').textContent = Math.round(freezing) + ' m';
    document.getElementById('stationElevation').textContent = Math.round(state.currentLocation.elevation) + ' m';
    document.getElementById('cloudBaseSummary').textContent = cloudBase !== null ? cloudBase + 'm' : 'N/A';
    document.getElementById('boundaryLayerSummary').textContent = Math.round(boundaryLayer) + 'm';
    document.getElementById('freezingLevelSummary').textContent = Math.round(freezing) + 'm';
    document.getElementById('stationElevationSummary').textContent = Math.round(state.currentLocation.elevation) + 'm';
    const weatherInfo = getWeatherInfo(weatherCode);
    document.getElementById('weatherDesc').textContent = weatherInfo.icon + ' ' + weatherInfo.text;
    document.getElementById('currentTemp').textContent = temp !== null ? Math.round(temp) + '°C' : '-';

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

// PHASE 1 SAFETY: Killer-Kriterien
function updateKillers(ws, wg, w700, grad, cape, vis) {
    state.activeKillers = [];
    const gustFactor = getGustFactor(ws, wg);

    if (cape > LIMITS.cape.yellow) {
        state.activeKillers.push({ icon: '⛈️', text: 'Gewittergefahr', value: 'CAPE ' + Math.round(cape) + ' J/kg', reason: 'Hohe Konvektionsenergie = CB-Entwicklung möglich' });
    }

    const inAlps = isInAlpineRegion(state.currentLocation.lat, state.currentLocation.lon);
    if (w700 > LIMITS.wind.w700.yellow && inAlps) {
        state.activeKillers.push({ icon: '🌪️', text: 'Föhngefahr', value: 'Höhenwind ' + Math.round(w700) + ' km/h', reason: 'Starker Höhenwind kann bis in Talnähe durchgreifen' });
    } else if (w700 > LIMITS.wind.w700.yellow && !inAlps) {
        state.activeKillers.push({ icon: '💨', text: 'Starker Höhenwind', value: Math.round(w700) + ' km/h auf 3000m', reason: 'Kann Thermikflüge in der Höhe beeinflussen' });
    }

    if (grad > LIMITS.wind.gradient.yellow) {
        state.activeKillers.push({ icon: '📊', text: 'Gefährliche Windscherung', value: 'Gradient ' + Math.round(grad) + ' km/h', reason: 'Starke Turbulenz beim Höhenwechsel' });
    }

    if (vis < LIMITS.visibility.yellow) {
        state.activeKillers.push({ icon: '🌫️', text: 'Schlechte Sicht', value: (vis/1000).toFixed(1) + ' km', reason: 'Orientierung und Landeplatzerkennung stark erschwert' });
    }

    if (wg > LIMITS.wind.gusts.yellow + 5 || (gustFactor > 1.0 && wg > LIMITS.wind.gusts.green)) {
        const reason = gustFactor > 1.0 ? 'Extrem böig – Böen mehr als doppelt so stark wie Grundwind' : 'Kontrollverlust und Einklapper wahrscheinlich';
        state.activeKillers.push({ icon: '💨', text: 'Gefährliche Böen', value: Math.round(wg) + ' km/h (Faktor ' + gustFactor.toFixed(1) + ')', reason: reason });
    }

    const el = document.getElementById('killerWarnings'), list = document.getElementById('killerList');
    if (state.activeKillers.length > 0) {
        el.classList.add('visible');
        list.innerHTML = state.activeKillers.map(k =>
            '<div class="killer-item-big"><span class="killer-item-icon">' + k.icon + '</span><div><div class="killer-item-text">' + k.text + ': <span class="killer-item-value">' + k.value + '</span></div><div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">' + k.reason + '</div></div></div>'
        ).join('');
    } else {
        el.classList.remove('visible');
    }
    return state.activeKillers.length > 0;
}

// PHASE 1 SAFETY: Kurzfassung
function updateReasonSummary(score, ws, wg, w700, grad, cape, vis, spread, cloudLow) {
    const el = document.getElementById('reasonSummary'), textEl = document.getElementById('reasonText');
    el.className = 'reason-summary';
    const gustSpread = wg - ws; // Böen-Differenz

    if (score === 3) {
        el.classList.add('go');
        textEl.innerHTML = '✓ <strong>Alle Parameter im sicheren Bereich.</strong> Gute Bedingungen für einen Flug – dennoch vor Ort die Verhältnisse prüfen.';
    } else if (score === 1) {
        el.classList.add('nogo');
        const criticals = [];
        const inAlps = isInAlpineRegion(state.currentLocation.lat, state.currentLocation.lon);
        if (cape > LIMITS.cape.yellow) criticals.push({ name: 'CAPE', value: Math.round(cape) + ' J/kg', issue: 'Gewittergefahr' });
        if (w700 > LIMITS.wind.w700.yellow) criticals.push({ name: 'Höhenwind', value: Math.round(w700) + ' km/h', issue: inAlps ? 'Föhngefahr' : 'zu stark' });
        if (wg > LIMITS.wind.gusts.yellow) criticals.push({ name: 'Böen', value: Math.round(wg) + ' km/h', issue: 'zu stark' });
        if (gustSpread > LIMITS.wind.gustSpread.yellow) criticals.push({ name: 'Böigkeit', value: Math.round(gustSpread) + ' km/h', issue: 'unruhig' });
        if (grad > LIMITS.wind.gradient.yellow) criticals.push({ name: 'Gradient', value: Math.round(grad) + ' km/h', issue: 'Windscherung' });
        if (vis < LIMITS.visibility.yellow) criticals.push({ name: 'Sicht', value: (vis/1000).toFixed(1) + ' km', issue: 'zu schlecht' });
        if (spread !== null && spread < LIMITS.spread.min) criticals.push({ name: 'Spread', value: spread.toFixed(1) + '°C', issue: 'Nebel' });

        if (criticals.length > 0) {
            const main = criticals.slice(0, 2);
            textEl.innerHTML = '✗ <strong>Nicht fliegbar wegen:</strong> ' + main.map(c => '<span class="reason-param red">' + c.name + ' ' + c.value + '</span> (' + c.issue + ')').join(', ');
        } else {
            textEl.innerHTML = '✗ <strong>Mehrere Parameter im kritischen Bereich.</strong> Siehe Warnungen unten.';
        }
    } else {
        el.classList.add('caution');
        const elevated = [];
        if (wg > LIMITS.wind.gusts.green) elevated.push({ name: 'Böen', value: Math.round(wg) + ' km/h' });
        if (gustSpread > LIMITS.wind.gustSpread.green) elevated.push({ name: 'Böigkeit', value: Math.round(gustSpread) + ' km/h Differenz' });
        if (w700 > LIMITS.wind.w700.green) elevated.push({ name: 'Höhenwind', value: Math.round(w700) + ' km/h' });
        if (ws > LIMITS.wind.surface.green) elevated.push({ name: 'Bodenwind', value: Math.round(ws) + ' km/h' });
        if (cape > LIMITS.cape.green) elevated.push({ name: 'CAPE', value: Math.round(cape) + ' J/kg' });
        if (grad > LIMITS.wind.gradient.green) elevated.push({ name: 'Gradient', value: Math.round(grad) + ' km/h' });
        if (cloudLow > LIMITS.clouds.low.green) elevated.push({ name: 'Tiefe Wolken', value: cloudLow + '%' });

        if (elevated.length > 0) {
            const main = elevated.slice(0, 2);
            textEl.innerHTML = '⚠ <strong>Hauptgrund:</strong> ' + main.map(e => '<span class="reason-param yellow">' + e.name + ' ' + e.value + '</span>').join(' und ') + '. Erhöhte Aufmerksamkeit nötig.';
        } else {
            textEl.innerHTML = '⚠ <strong>Einige Parameter leicht erhöht.</strong> Siehe gelbe Hinweise unten.';
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

    if (spread >= LIMITS.spread.min && spread < LIMITS.spread.optimalMin) {
        warnings.push({ level: 'yellow', text: '💧 Spread niedrig (' + spread.toFixed(1) + '°C)' });
    }

    if (cape <= LIMITS.cape.yellow && cape > LIMITS.cape.green) {
        warnings.push({ level: 'yellow', text: '🌤️ CAPE erhöht (' + Math.round(cape) + ' J/kg)' });
    }

    if (li < LIMITS.liftedIndex.yellow) warnings.push({ level: 'red', text: '⚡ Lifted Index ' + li.toFixed(1) + ' – stark labil' });
    else if (li < LIMITS.liftedIndex.green) warnings.push({ level: 'yellow', text: '⚡ Lifted Index ' + li.toFixed(1) + ' – labil' });

    if (cloudLow > LIMITS.clouds.low.yellow) warnings.push({ level: 'red', text: '☁️ Tiefe Bewölkung ' + cloudLow + '%' });
    else if (cloudLow > LIMITS.clouds.low.green) warnings.push({ level: 'yellow', text: '☁️ Tiefe Bewölkung ' + cloudLow + '%' });

    if (vis < LIMITS.visibility.yellow) {
        warnings.push({ level: 'red', text: '🌫️ Sicht gefährlich schlecht (' + (vis/1000).toFixed(1) + ' km)' });
    } else if (vis < LIMITS.visibility.green) {
        warnings.push({ level: 'yellow', text: '🌫️ Sicht eingeschränkt (' + (vis/1000).toFixed(1) + ' km)' });
    }

    if (precip > LIMITS.precip.yellow) warnings.push({ level: 'red', text: '🌧️ Niederschlag ' + precip.toFixed(1) + ' mm' });
    else if (precip > LIMITS.precip.green) warnings.push({ level: 'yellow', text: '🌧️ Leichter Niederschlag möglich' });

    if (showers > LIMITS.showers.yellow) warnings.push({ level: 'red', text: '⛈️ Schauer erwartet (' + showers.toFixed(1) + ' mm)' });
    else if (showers > LIMITS.showers.green) warnings.push({ level: 'yellow', text: '🌦️ Lokale Schauer möglich' });

    if (freezing < 2000) warnings.push({ level: 'yellow', text: '❄️ Nullgradgrenze niedrig (' + Math.round(freezing) + 'm)' });
    if (boundaryLayer < 1000) warnings.push({ level: 'yellow', text: '📉 Grenzschicht nur ' + Math.round(boundaryLayer) + 'm – schwache Thermik' });

    const el = document.getElementById('warnings'), list = document.getElementById('warningsList');
    if (warnings.length) {
        el.classList.add('visible');
        list.innerHTML = warnings.map(w => '<div class="warning-item ' + w.level + '">' + w.text + '</div>').join('');
    } else {
        el.classList.remove('visible');
    }
}

// Windrose aktualisieren
function updateWindrose(wdSurface, wd850, wd700, wsSurface, ws850, ws700) {
    document.getElementById('windArrowSurface').style.transform = 'translate(-50%, -100%) rotate(' + wdSurface + 'deg)';
    document.getElementById('windArrow850').style.transform = 'translate(-50%, -100%) rotate(' + wd850 + 'deg)';
    document.getElementById('windArrow700').style.transform = 'translate(-50%, -100%) rotate(' + wd700 + 'deg)';
    document.getElementById('windroseSurface').textContent = Math.round(wsSurface) + ' km/h ' + getWindDir(wdSurface);
    document.getElementById('windrose850').textContent = Math.round(ws850) + ' km/h ' + getWindDir(wd850);
    document.getElementById('windrose700').textContent = Math.round(ws700) + ' km/h ' + getWindDir(wd700);

    const diff1 = Math.abs(wdSurface - wd850), norm1 = diff1 > 180 ? 360 - diff1 : diff1;
    const diff2 = Math.abs(wdSurface - wd700), norm2 = diff2 > 180 ? 360 - diff2 : diff2;
    const shearWarning = document.getElementById('windroseShearWarning');
    if ((norm1 > 45 && ws850 > 15) || (norm2 > 60 && ws700 > 20)) {
        shearWarning.classList.add('visible');
    } else {
        shearWarning.classList.remove('visible');
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
