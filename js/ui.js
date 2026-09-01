/**
 * SkyCheck - UI-Modul
 * DOM-Updates, Rendering, Darstellungs-Logik
 * v9 - Mit formatValue für sichere Anzeige
 */

import { state } from './state.js';
import { LIMITS, STORAGE_KEYS, UI_CONFIG, APP_INFO } from './config.js';
import {
    getWindDir, getColorClass, getColorClassRev, getSpreadColor,
    scoreToColor, getTrend, getWeatherInfo,
    escapeHtml, validateCustomLimits, formatAge
} from './utils.js';
import {
    updateSunTimes, calculateCloudBase,
    calculateBeginnerSafety, getFogRisk, extractWindData,
    getEffectiveLimits, getHourAssessment, rebuildHourlyAssessments
} from './weather.js';
import { V10_TIME_WINDOWS } from './aggregation.js';
import { EXPERT_PRESETS, buildCustomLimits } from './expert-profiles.js';
import {
    DASHBOARD_LABELS,
    buildDashboardDayView,
    buildDashboardHourView,
    findBestWeatherWindow
} from './dashboard.js';

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
    const times = state.hourlyWeather.map(hour => hour.time);
    const uniqueDays = [...new Set(times.map(t => t.split('T')[0]))].slice(0, 3);

    uniqueDays.forEach((dayStr) => {
        const indices = [];
        times.forEach((t, i) => { if (t.startsWith(dayStr)) indices.push(i); });

        let worst = 3, windScore = 3, thermikScore = 3, cloudScore = 3, precipScore = 3;
        indices.forEach(i => {
            const hour = new Date(times[i]).getHours();
            if (hour >= V10_TIME_WINDOWS.categorySummary.start && hour <= V10_TIME_WINDOWS.categorySummary.end) {
                const assessment = getHourAssessment(i);
                const s = assessment?.score ?? 2;
                if (s < worst) worst = s;
                const category = assessment?.categories || {};
                windScore = Math.min(windScore, category.wind ?? 2);
                thermikScore = Math.min(thermikScore, category.thermik ?? 2);
                cloudScore = Math.min(cloudScore, category.clouds ?? 2);
                precipScore = Math.min(precipScore, category.precip ?? 2);
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
 * Tages-Auswahl bauen (mit Ampel und Zeitfenster)
 */
export function buildDayComparison() {
    const grid = document.getElementById('dayComparisonGrid');
    grid.innerHTML = '';

    state.forecastDays.forEach((day, i) => {
        const d = new Date(day.date);
        const names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
        const name = i === 0 ? 'Heute' : i === 1 ? 'Morgen' : names[d.getDay()];
        const view = buildDashboardDayView(
            state.hourlyWeather,
            state.hourlyAssessments,
            day.date,
            confidenceForDay(day.date),
            state.forecastConfidence.hourly
        );

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'day-comparison-card' + (i === state.selectedDay ? ' active' : '');
        card.dataset.dayIdx = i;
        card.setAttribute('role', 'tab');
        card.setAttribute('aria-selected', i === state.selectedDay ? 'true' : 'false');
        card.innerHTML = `
            <div class="day-comparison-date">${name} ${d.getDate()}.${d.getMonth() + 1}.</div>
            <span class="day-comparison-status ${view.safety.level}">Flugcharakter: ${view.safety.label}</span>
            <span class="day-comparison-thermal ${view.thermal.level}">Thermik: ${view.thermal.label}</span>
            <span class="day-comparison-window">${view.bestWindow?.timeLabel || 'Kein Fenster'}</span>`;
        grid.appendChild(card);
    });
}

/**
 * Tag auswählen
 */
export function selectDay(idx) {
    state.selectedDay = idx;
    document.querySelectorAll('.day-comparison-card').forEach((c, i) => {
        c.classList.toggle('active', i === idx);
        c.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    updateSunTimes(idx);
    updateForecastConfidence(idx);
    renderDashboardDay(idx);
    buildTimeline(state.forecastDays[idx].date);

    // Wind-Profil immer aktualisieren (ist jetzt immer sichtbar)
    renderWindDiagram(state.forecastDays[idx].date);

    const now = new Date(), ch = now.getHours();
    let def = state.forecastDays[idx].indices.find(i => new Date(state.hourlyWeather[i].time).getHours() === (idx === 0 ? ch : 12));
    if (def === undefined) def = state.forecastDays[idx].indices.find(i => new Date(state.hourlyWeather[i].time).getHours() === 12) ?? state.forecastDays[idx].indices[Math.floor(state.forecastDays[idx].indices.length / 2)];
    selectHour(def);
}

export function updateForecastConfidence(dayIdx) {
    const levelEl = document.getElementById('confidenceLevel');
    const modelEl = document.getElementById('confidenceModels');
    const reasonsEl = document.getElementById('confidenceReasons');
    const metaEl = document.getElementById('confidenceMeta');
    if (!levelEl || !modelEl || !reasonsEl || !metaEl) return;

    const labels = { high: 'hoch', medium: 'mittel', low: 'gering', unknown: 'unbekannt' };
    const renderComponent = (id, level) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.textContent = labels[level] || '—';
        element.className = `confidence-value ${level || 'unknown'}`;
    };
    const resetReasons = () => {
        while (reasonsEl.firstChild) reasonsEl.removeChild(reasonsEl.firstChild);
    };
    const confidenceState = state.forecastConfidence;

    if (confidenceState.status === 'loading' || confidenceState.status === 'idle') {
        levelEl.textContent = 'wird geladen…';
        levelEl.className = 'confidence-level unknown';
        modelEl.textContent = 'ICON-D2 · ICON-EU · AROME Austria · ECMWF IFS werden parallel verglichen.';
        metaEl.textContent = 'Die Hauptprognose bleibt währenddessen vollständig nutzbar.';
        resetReasons();
        ['confidenceWind', 'confidenceThermal', 'confidenceClouds', 'confidencePrecipitation']
            .forEach(id => renderComponent(id, 'unknown'));
        renderDashboardDay(dayIdx);
        return;
    }

    const day = state.forecastDays[dayIdx];
    const daily = confidenceState.daily?.find(item => item.date === day?.date);
    const level = daily?.level || 'unknown';
    levelEl.textContent = labels[level];
    levelEl.className = `confidence-level ${level}`;
    renderComponent('confidenceWind', daily?.components?.wind || 'unknown');
    renderComponent('confidenceThermal', daily?.components?.thermal || 'unknown');
    renderComponent('confidenceClouds', daily?.components?.clouds || 'unknown');
    renderComponent('confidencePrecipitation', daily?.components?.precipitation || 'unknown');

    if (confidenceState.models?.length > 0) {
        modelEl.textContent = confidenceState.models.map(model =>
            `${model.displayName} ${model.status === 'available' ? '✓' : '—'}`
        ).join(' · ');
        modelEl.title = confidenceState.models
            .filter(model => model.status !== 'available' && model.error)
            .map(model => `${model.displayName}: ${model.error}`)
            .join('\n');
    } else {
        modelEl.textContent = 'Keine Modellantwort verfügbar.';
        modelEl.removeAttribute('title');
    }

    resetReasons();
    for (const reason of daily?.reasons || []) {
        const item = document.createElement('li');
        item.className = reason.tone || 'neutral';
        const prefix = reason.tone === 'positive' ? '+' : reason.tone === 'negative' ? '−' : '•';
        item.textContent = `${prefix} ${reason.text}`;
        reasonsEl.appendChild(item);
    }
    const performance = confidenceState.performance;
    metaEl.textContent = performance
        ? `${daily?.metrics?.evaluatedHours || 0} Flugfenster-Stunden · ${performance.requestCount} API-Aufrufe · ${performance.cacheHits} Cache-Treffer`
        : 'Consensus nicht verfügbar.';
    renderDashboardDay(dayIdx);
    buildDayComparison();
    if (state.selectedHourIndex !== null) {
        renderDashboardHour(state.selectedHourIndex);
        if (state.forecastDays[dayIdx]) buildTimeline(state.forecastDays[dayIdx].date);
    }
}

function setDashboardLevel(element, group, level) {
    if (!element) return;
    const levels = Object.keys(DASHBOARD_LABELS[group] || {});
    element.classList.remove(...levels);
    element.classList.add(level || 'unknown');
}

function confidenceForDay(dayStr) {
    return state.forecastConfidence.daily?.find(item => item.date === dayStr) || null;
}

function confidenceForHour(time) {
    return state.forecastConfidence.hourly?.find(item => item.time === time) || null;
}

function formatDashboardDate(dayStr) {
    const date = new Date(`${dayStr}T12:00`);
    return new Intl.DateTimeFormat('de-DE', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit'
    }).format(date);
}

function renderDashboardDay(dayIdx = state.selectedDay) {
    const day = state.forecastDays?.[dayIdx];
    if (!day) return;
    const view = buildDashboardDayView(
        state.hourlyWeather,
        state.hourlyAssessments,
        day.date,
        confidenceForDay(day.date),
        state.forecastConfidence.hourly
    );
    const safety = document.getElementById('dashboardSafety');
    const thermal = document.getElementById('dashboardThermal');
    const foehn = document.getElementById('dashboardFoehn');
    const consensus = document.getElementById('dashboardConsensus');
    setDashboardLevel(safety, 'safety', view.safety.level);
    setDashboardLevel(thermal, 'thermal', view.thermal.level);
    setDashboardLevel(foehn, 'foehn', view.foehn.level);
    setDashboardLevel(consensus, 'confidence', view.confidence.level);
    document.getElementById('dashboardDate').textContent = formatDashboardDate(day.date);
    document.getElementById('dashboardSafetyValue').textContent = view.safety.label;
    document.getElementById('dashboardSafetyDetail').textContent = view.safety.level === 'unknown'
        ? view.dataQualityReason
        : 'Schwerste Ausprägung zwischen 06 und 20 Uhr.';
    document.getElementById('dashboardThermalValue').textContent = view.thermal.label;
    document.getElementById('dashboardThermalDetail').textContent = view.thermalDay.reasons?.[0] || 'Keine Thermikangabe.';
    document.getElementById('dashboardFoehnValue').textContent = view.foehn.label;
    document.getElementById('dashboardConsensusValue').textContent = state.forecastConfidence.status === 'loading'
        ? 'Wird geladen…'
        : view.confidence.label;

    const windowCard = document.getElementById('dashboardWindow');
    windowCard.classList.remove('thermal', 'quiet', 'conflict', 'unknown');
    if (view.bestWindow) {
        windowCard.classList.add(view.bestWindow.type);
        document.getElementById('dashboardWindowLabel').textContent = view.bestWindow.label;
        document.getElementById('dashboardWindowTime').textContent = view.bestWindow.timeLabel;
        document.getElementById('dashboardWindowDetail').textContent = view.bestWindow.description;
    } else if (view.hasThermalConflict) {
        windowCard.classList.add('conflict');
        document.getElementById('dashboardWindowLabel').textContent = 'Kein interessantes Wetterfenster';
        document.getElementById('dashboardWindowTime').textContent = 'Starke Thermik trifft auf kritische Indikatoren';
        document.getElementById('dashboardWindowDetail').textContent = 'Thermik und Flugcharakter bleiben bewusst getrennt dargestellt.';
    } else {
        windowCard.classList.add('unknown');
        document.getElementById('dashboardWindowLabel').textContent = 'Kein interessantes Wetterfenster';
        document.getElementById('dashboardWindowTime').textContent = 'Im betrachteten Zeitraum nicht vorhanden';
        document.getElementById('dashboardWindowDetail').textContent = 'Die Einzelindikatoren bleiben darunter vollständig sichtbar.';
    }

    const hints = document.getElementById('dashboardHints');
    hints.replaceChildren(...view.hints.map(hint => {
        const paragraph = document.createElement('p');
        paragraph.className = `dashboard-hint ${hint.tone}`;
        paragraph.textContent = hint.text;
        return paragraph;
    }));
    const dataQuality = document.getElementById('dashboardDataQuality');
    dataQuality.textContent = view.dataQualityReason || '';
    dataQuality.classList.toggle('u-hidden', !view.dataQualityReason);

    document.getElementById('flightCharacterLevel').textContent = view.safety.label;
    document.getElementById('flightCharacterReason').textContent = view.hints[0]?.text || 'Kein dominanter Belastungsfaktor im Tagesprofil.';
    document.getElementById('thermalXcLevel').textContent = view.thermal.label;
    document.getElementById('thermalXcReason').textContent = view.thermalDay.reasons?.join(' · ') || 'Keine belastbare Tagesaggregation.';
    document.getElementById('foehnDetailLevel').textContent = view.foehn.label;
    document.getElementById('foehnDetailReason').textContent = view.foehn.level === 'notApplicable'
        ? 'Standort liegt außerhalb des anwendbaren Alpenraums.'
        : view.foehn.level === 'high' || view.foehn.level === 'critical'
            ? 'Mehrere Föhnindikatoren verlangen besondere Aufmerksamkeit.'
            : 'Föhnindikatoren werden unabhängig vom Flugcharakter gezeigt.';
}

function renderDashboardHour(index) {
    const hour = state.hourlyWeather[index];
    const assessment = getHourAssessment(index);
    if (!hour || !assessment) return;
    const view = buildDashboardHourView(hour, assessment, confidenceForHour(hour.time));
    document.getElementById('selectedHourTitle').textContent = view.timeLabel;
    const dimensions = document.getElementById('hourDimensions');
    const values = [
        ['Flugcharakter', view.safety],
        ['Thermik', view.thermal],
        ['Föhn', view.foehn],
        ['Konsens', view.confidence]
    ];
    dimensions.replaceChildren(...values.map(([name, value]) => {
        const item = document.createElement('div');
        item.className = `hour-dimension ${value.level}`;
        const label = document.createElement('span');
        label.textContent = name;
        const strong = document.createElement('strong');
        strong.textContent = value.label;
        item.append(label, strong);
        return item;
    }));
    const renderList = (id, entries) => {
        const list = document.getElementById(id);
        list.replaceChildren(...entries.map(text => {
            const item = document.createElement('li');
            item.textContent = text;
            return item;
        }));
    };
    renderList('hourWindSummary', Object.values(view.wind));
    renderList('hourThermalSummary', Object.values(view.thermalSummary));
    document.getElementById('flightCharacterLevel').textContent = view.safety.label;
    document.getElementById('flightCharacterReason').textContent = view.dataQualityReason || view.limitingFactor;
    document.getElementById('thermalXcLevel').textContent = view.thermal.label;
    document.getElementById('thermalXcReason').textContent = Object.values(view.thermalSummary).join(' · ');
    document.getElementById('foehnDetailLevel').textContent = view.foehn.label;
    const foehnReasons = assessment.foehn?.reasons || [];
    document.getElementById('foehnDetailReason').textContent = foehnReasons[0]?.text || foehnReasons[0] ||
        (view.foehn.level === 'notApplicable' ? 'Außerhalb des anwendbaren Alpenraums.' : 'Kein dominantes Föhnsignal in dieser Stunde.');
}

/**
 * v8 NEU: Timeline mit Wetter-Symbolen
 * PHASE 1 SAFETY: Konditioniertes Zeitfenster
 */
export function buildTimeline(dayStr) {
    const tl = document.getElementById('timeline');
    tl.innerHTML = '';
    const bestWin = findBestWeatherWindow(
        state.hourlyWeather,
        state.hourlyAssessments,
        dayStr,
        state.forecastConfidence.hourly
    );

    const now = new Date();
    // todayStr aus normalisierten Stunden (lokale Zeitzone des Orts) ableiten, nicht aus UTC -
    // sonst Mismatch nahe Mitternacht/Zeitzonen-Offset (siehe favorites.js fetchQuickWeather)
    const todayStr = state.hourlyWeather[0].time.split('T')[0];
    const currentHour = now.getHours();
    const isToday = dayStr === todayStr;

    for (let h = 6; h <= 20; h++) {
        const ts = dayStr + 'T' + h.toString().padStart(2, '0') + ':00';
        const idx = state.hourlyWeather.findIndex(hour => hour.time === ts);
        if (idx === -1) continue;

        const assessment = getHourAssessment(idx);
        const safety = assessment?.safety?.level || 'unknown';
        const thermal = assessment?.thermal?.level || 'unknown';
        const foehn = assessment?.foehn?.applicability === 'notApplicable'
            ? 'notApplicable'
            : assessment?.foehn?.level || 'unknown';
        const confidence = confidenceForHour(state.hourlyWeather[idx].time)?.level || 'unknown';
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = `timeline-slot safety-${safety}`;
        slot.dataset.hourIdx = idx;
        slot.setAttribute('role', 'option');
        slot.setAttribute('aria-selected', idx === state.selectedHourIndex ? 'true' : 'false');
        slot.setAttribute('aria-label', `${h}:00, Flugcharakter ${DASHBOARD_LABELS.safety[safety]}, Thermik ${DASHBOARD_LABELS.thermal[thermal]}, Föhn ${DASHBOARD_LABELS.foehn[foehn]}, Modellkonsens ${DASHBOARD_LABELS.confidence[confidence]}`);
        if (idx === state.selectedHourIndex) slot.classList.add('active');
        if (bestWin?.indices.includes(idx)) {
            slot.classList.add('best');
        }
        // Aktuelle Stunde markieren (nur heute)
        if (isToday && h === currentHour) {
            slot.classList.add('now');
        }

        const isMobile = window.innerWidth < UI_CONFIG.mobileBreakpoint;
        const timeText = isMobile ? h : h + ':00';
        const foehnMarker = foehn === 'elevated' || foehn === 'high' || foehn === 'critical'
            ? `<span class="timeline-marker foehn ${foehn}" title="Föhn ${DASHBOARD_LABELS.foehn[foehn]}">▲</span>`
            : '';
        const confidenceMarker = confidence === 'low'
            ? '<span class="timeline-marker low-consensus" title="Geringer Modellkonsens">≋</span>'
            : '';
        slot.innerHTML = `<span class="slot-time">${timeText}</span><span class="timeline-markers"><span class="timeline-marker safety ${safety}" aria-hidden="true">●</span><span class="timeline-marker thermal ${thermal}" aria-hidden="true">◆</span>${foehnMarker}${confidenceMarker}</span>`;
        tl.appendChild(slot);
    }
}

/**
 * Stunde auswählen
 */
export function selectHour(idx) {
    state.selectedHourIndex = idx;
    updateDisplay(idx);
    renderDashboardHour(idx);
    buildTimeline(state.forecastDays[state.selectedDay].date);

    // Wind-Profil aktualisieren (um ausgewählte Stunde zu markieren)
    renderWindDiagram(state.forecastDays[state.selectedDay].date);
}

function updateFoehnDiagnostic(foehn) {
    const riskEl = document.getElementById('foehnRisk');
    const statusEl = document.getElementById('foehnStatus');
    if (!riskEl || !statusEl || !foehn) return;

    const levelLabels = {
        low: 'Niedrig',
        elevated: 'Föhnige Tendenz',
        high: 'Hoch',
        critical: 'Kritisch',
        unknown: 'Unbekannt'
    };
    const levelClasses = {
        low: 'green',
        elevated: 'yellow',
        high: 'red',
        critical: 'red',
        unknown: 'no-data'
    };
    const typeLabels = {
        south: 'Südföhn-Signal',
        north: 'Nordföhn-Signal',
        none: 'Kein eindeutiger Typ',
        uncertain: 'Widersprüchlich/unsicher'
    };
    const trendLabels = {
        increasing: 'Zunehmend',
        steady: 'Gleichbleibend',
        decreasing: 'Abnehmend',
        unknown: 'Unbekannt'
    };
    const confidenceLabels = { high: 'Hoch', medium: 'Mittel', low: 'Gering' };

    if (foehn.applicability === 'notApplicable') {
        riskEl.textContent = 'Nicht anwendbar';
        riskEl.className = 'param-value no-data';
        statusEl.className = 'param-status no-data';
        document.getElementById('foehnType').textContent = 'Außerhalb Alpenraum';
        document.getElementById('foehnPressure').textContent = '—';
        document.getElementById('foehnFlow').textContent = '—';
        document.getElementById('foehnTrend').textContent = '—';
        document.getElementById('foehnConfidence').textContent = '—';
        return;
    }

    riskEl.textContent = levelLabels[foehn.level] || levelLabels.unknown;
    riskEl.className = `param-value ${levelClasses[foehn.level] || 'no-data'}`;
    statusEl.className = `param-status ${levelClasses[foehn.level] || 'no-data'}`;
    document.getElementById('foehnType').textContent = typeLabels[foehn.type] || typeLabels.uncertain;
    const delta = foehn.metrics?.pressure?.deltaHpa;
    document.getElementById('foehnPressure').textContent = Number.isFinite(delta)
        ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} hPa`
        : 'Nicht verfügbar';
    const flow = foehn.metrics?.flow?.selected;
    document.getElementById('foehnFlow').textContent = flow?.matchingLevelCount > 0
        ? `${getWindDir(flow.dominantDirectionDeg)}, ${Math.round(flow.averageSpeedKmh)} km/h (${flow.matchingLevelCount}/3 Level)`
        : 'Kein konsistentes Signal';
    document.getElementById('foehnTrend').textContent = trendLabels[foehn.trend] || trendLabels.unknown;
    document.getElementById('foehnConfidence').textContent = confidenceLabels[foehn.confidence] || 'Gering';
}

/**
 * v9: updateDisplay (750hPa entfernt)
 */
export function updateDisplay(i) {
    const hour = state.hourlyWeather[i];
    const assessment = getHourAssessment(i);
    if (!hour || !assessment) return;

    const previousAssessment = i > 0 ? getHourAssessment(i - 1) : null;
    const previous = previousAssessment?.metrics || {};
    const L = assessment.effectiveLimits;
    const {
        ws, wg, w900, w850, w800, w700, gustSpread,
        gradient1500: grad, gradient3000: grad3000, spread,
        cape, liftedIndex: li, visibility: vis, cloudLow: cl,
        cloudTotal: ct, precipitation: prec,
        precipitationProbability: pp, showers
    } = assessment.metrics;
    const wind = extractWindData(hour);
    const temp = hour.surface.temperatureC;
    const dew = hour.surface.dewPointC;
    const cm = hour.clouds.midPct;
    const cloudHigh = hour.clouds.highPct;
    const freezing = hour.freezingLevelM;
    const boundaryLayer = hour.boundaryLayer.heightM;
    const weatherCode = hour.weatherCode ?? 0;
    const elevation = state.currentLocation.elevation;
    const cloudBase = temp !== null && dew !== null && Number.isFinite(elevation)
        ? calculateCloudBase(temp, dew, elevation)
        : null;

    const windSc = assessment.categories.wind ?? 2;
    const thermSc = assessment.categories.thermik ?? 2;
    const cloudSc = assessment.categories.clouds ?? 2;
    const precSc = assessment.categories.precip ?? 2;
    const worst = assessment.score;

    updateOverallAssessment(worst);

    const beginnerAssessment = worst === 3 && assessment.dataQuality?.level === 'good'
        ? calculateBeginnerSafety(i)
        : { isBeginner: false };
    renderBeginnerBadge(beginnerAssessment);
    renderRiskExplanation(null);
    document.getElementById('killerWarnings')?.classList.remove('visible');
    updateReasonSummary(assessment);
    updateFoehnDiagnostic(assessment.foehn);
    updateWindrose(
        wind.wd10m, wind.wd900, wind.wd850, wind.wd700,
        ws, w900, w850, w700
    );

    const dom = getDomCache();
    dom.cloudBase.textContent = cloudBase !== null ? cloudBase + ' m' : 'N/A';
    dom.boundaryLayer.textContent = boundaryLayer !== null ? Math.round(boundaryLayer) + ' m' : 'n.v.';
    dom.freezingLevel.textContent = freezing !== null ? Math.round(freezing) + ' m' : 'N/A';
    dom.stationElevation.textContent = Number.isFinite(elevation) ? Math.round(elevation) + ' m' : 'N/A';
    const weatherInfo = getWeatherInfo(weatherCode);
    dom.weatherDesc.textContent = weatherInfo.icon + ' ' + weatherInfo.text;
    dom.currentTemp.textContent = temp !== null ? Math.round(temp) + '°C' : '-';

    const safeTrend = (current, prior) => current === null
        ? { symbol: '', cls: 'stable' }
        : getTrend(current, prior ?? null);
    const formatNumber = (value, decimals = 0) => value === null ? 'N/A' : value.toFixed(decimals);
    const formatDirection = value => value === null ? 'N/A' : Math.round(value) + '° ' + getWindDir(value);
    const valueClass = (value, limits, reverse = false) => value === null
        ? 'no-data'
        : (reverse ? getColorClassRev(value, limits) : getColorClass(value, limits));
    const setWindValue = (id, value, trend, limits) => {
        const el = document.getElementById(id);
        el.innerHTML = value === null
            ? '<span class="no-data">N/A</span>'
            : Math.round(value) + ' km/h <span class="trend ' + trend.cls + '">' + trend.symbol + '</span>';
        el.className = 'param-value ' + valueClass(value, limits);
    };

    setWindValue('windSurface', ws, safeTrend(ws, previous.ws), L.wind.surface);
    document.getElementById('windDirSurface').textContent = formatDirection(wind.wd10m);
    setWindValue('windGusts', wg, safeTrend(wg, previous.wg), L.wind.gusts);

    document.getElementById('gustSpread').textContent = gustSpread === null ? 'N/A' : Math.round(gustSpread) + ' km/h';
    document.getElementById('gustSpread').className = 'param-value ' + valueClass(gustSpread, L.wind.gustSpread);
    setWindValue('wind900', w900, safeTrend(w900, previous.w900), L.wind.w900);
    document.getElementById('windDir900').textContent = formatDirection(wind.wd900);
    setWindValue('wind850', w850, safeTrend(w850, previous.w850), L.wind.w850);
    document.getElementById('windDir850').textContent = formatDirection(wind.wd850);
    setWindValue('wind800', w800, safeTrend(w800, previous.w800), L.wind.w800);
    document.getElementById('windDir800').textContent = formatDirection(wind.wd800);
    setWindValue('wind700', w700, safeTrend(w700, previous.w700), L.wind.w700);
    document.getElementById('windDir700').textContent = formatDirection(wind.wd700);

    document.getElementById('windGradient').textContent = grad === null ? 'N/A' : Math.round(grad) + ' km/h';
    document.getElementById('windGradient').className = 'param-value ' + valueClass(grad, L.wind.gradient);
    document.getElementById('windGradient3000').textContent = grad3000 === null ? 'N/A' : Math.round(grad3000) + ' km/h';
    document.getElementById('windGradient3000').className = 'param-value ' + valueClass(grad3000, L.wind.gradient3000);
    document.getElementById('windStatus').className = 'param-status ' + scoreToColor(windSc);

    document.getElementById('temp2m').textContent = temp !== null ? temp.toFixed(1) + '°C' : 'N/A';
    document.getElementById('dewpoint').textContent = dew !== null ? dew.toFixed(1) + '°C' : 'N/A';
    document.getElementById('spread').textContent = spread !== null ? spread.toFixed(1) + '°C' : 'N/A';
    document.getElementById('spread').className = 'param-value ' + (spread === null ? 'no-data' : getSpreadColor(spread, L));
    const capeTrend = safeTrend(cape, previous.cape);
    document.getElementById('cape').innerHTML = cape === null
        ? '<span class="no-data">N/A</span>'
        : Math.round(cape) + ' J/kg <span class="trend ' + capeTrend.cls + '">' + capeTrend.symbol + '</span>';
    document.getElementById('cape').className = 'param-value ' + valueClass(cape, L.cape);
    document.getElementById('liftedIndex').textContent = formatNumber(li, 1);
    document.getElementById('liftedIndex').className = 'param-value ' + (li === null ? 'no-data' : li < L.liftedIndex.yellow ? 'red' : li < L.liftedIndex.green ? 'yellow' : 'green');
    document.getElementById('thermikStatus').className = 'param-status ' + scoreToColor(thermSc);

    document.getElementById('cloudTotal').textContent = ct === null ? 'N/A' : Math.round(ct) + '%';
    document.getElementById('cloudTotal').className = 'param-value ' + valueClass(ct, L.clouds.total);
    document.getElementById('cloudLow').textContent = cl === null ? 'N/A' : Math.round(cl) + '%';
    document.getElementById('cloudLow').className = 'param-value ' + valueClass(cl, L.clouds.low);
    document.getElementById('cloudMid').textContent = cm === null ? 'N/A' : Math.round(cm) + '%';
    document.getElementById('cloudHigh').textContent = cloudHigh === null ? 'N/A' : Math.round(cloudHigh) + '%';
    document.getElementById('visibility').textContent = vis === null ? 'N/A' : (vis / 1000).toFixed(1) + ' km';
    document.getElementById('visibility').className = 'param-value ' + valueClass(vis, L.visibility, true);
    document.getElementById('cloudStatus').className = 'param-status ' + scoreToColor(cloudSc);

    const fogRiskLevel = getFogRisk(spread, ws, vis);
    const fogRiskEl = document.getElementById('fogRisk');
    if (fogRiskEl) {
        const fogLabels = {
            severe: { text: 'Hoch 🌫️', class: 'red' },
            likely: { text: 'Wahrscheinlich ⚠️', class: 'yellow' },
            possible: { text: 'Möglich', class: 'yellow' },
            unlikely: { text: 'Gering ✓', class: 'green' },
            unknown: { text: 'Unbekannt', class: 'no-data' }
        };
        const fog = fogLabels[fogRiskLevel] || fogLabels.unknown;
        fogRiskEl.textContent = fog.text;
        fogRiskEl.className = 'param-value ' + fog.class;
    }

    document.getElementById('precip').textContent = prec === null ? 'N/A' : prec.toFixed(1) + ' mm';
    document.getElementById('precip').className = 'param-value ' + valueClass(prec, L.precip);
    document.getElementById('convPrecip').textContent = showers === null ? 'N/A' : showers.toFixed(1) + ' mm';
    document.getElementById('convPrecip').className = 'param-value ' + valueClass(showers, L.showers);
    document.getElementById('precipProb').textContent = pp === null ? 'N/A' : Math.round(pp) + '%';
    document.getElementById('precipProb').className = 'param-value ' + (pp === null ? 'no-data' : pp > L.precipProb.yellow ? 'yellow' : 'green');
    const thunderRisk = cape === null
        ? { text: 'Unbekannt', cls: 'no-data' }
        : cape > L.cape.yellow
            ? { text: 'Hoch ⛈️', cls: 'red' }
            : cape > L.cape.green
                ? { text: 'Moderat ⚠️', cls: 'yellow' }
                : { text: 'Gering ✓', cls: 'green' };
    document.getElementById('thunderRisk').textContent = thunderRisk.text;
    document.getElementById('thunderRisk').className = 'param-value ' + thunderRisk.cls;
    document.getElementById('precipStatus').className = 'param-status ' + scoreToColor(precSc);

    autoExpandRedCards();

    if (hour.time) {
        const dateObj = new Date(hour.time);
        const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
        const timeLabel = `${dayNames[dateObj.getDay()]} ${dateObj.getDate()}.${dateObj.getMonth() + 1}. · ${dateObj.getHours().toString().padStart(2, '0')}:00`;
        ['windTimeHint', 'foehnTimeHint', 'thermikTimeHint', 'cloudTimeHint', 'precipTimeHint'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = timeLabel;
        });
    }
    renderDashboardHour(i);
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
function updateReasonSummary(assessment) {
    const el = document.getElementById('reasonSummary');
    const textEl = document.getElementById('reasonText');
    const score = assessment.score;
    const filter = assessment.comfortFilters;
    const filterActive = !filter.wind || !filter.thermik || !filter.clouds || !filter.precip;

    el.className = 'reason-summary';
    if (score === 3) {
        el.classList.add('go');
        const filterHint = filterActive ? ' <span class="filter-hint">(Komfortfilter aktiv; Hard Blocker bleiben aktiv)</span>' : '';
        textEl.innerHTML = '✓ <strong>Alle verfügbaren Parameter im grünen Bereich.</strong>' + filterHint + ' Gute Bedingungen – dennoch vor Ort prüfen.';
        return;
    }

    el.classList.add(score === 1 ? 'nogo' : 'caution');
    const hints = assessment.reasons.length > 0
        ? assessment.reasons
        : [{ level: 'yellow', text: '⚠️ Bewertung aufgrund unvollständiger Daten eingeschränkt' }];
    const filterHint = filterActive
        ? '<div class="filter-hint" style="margin-top: 0.5rem; font-size: 0.8rem;">Komfortfilter aktiv; kritische Hard Blocker werden weiterhin berücksichtigt.</div>'
        : '';

    textEl.innerHTML = '<div class="hints-list">' +
        hints.map(hint => '<div class="hint-item ' + hint.level + '">' + escapeHtml(hint.text) + '</div>').join('') +
        '</div>' + filterHint;
}
// Windrose aktualisieren (nutzt DOM-Cache für Performance)
function updateWindrose(wdSurface, wd900, wd850, wd700, wsSurface, ws900, ws850, ws700) {
    const dom = getDomCache();

    const setLevel = (arrow, label, direction, speed) => {
        arrow.style.transform = direction === null
            ? 'translate(-50%, -100%)'
            : 'translate(-50%, -100%) rotate(' + direction + 'deg)';
        label.textContent = speed === null || direction === null
            ? 'N/A'
            : Math.round(speed) + ' km/h ' + getWindDir(direction);
    };
    setLevel(dom.windArrowSurface, dom.windroseSurface, wdSurface, wsSurface);
    setLevel(dom.windArrow900, dom.windrose900, wd900, ws900);
    setLevel(dom.windArrow850, dom.windrose850, wd850, ws850);
    setLevel(dom.windArrow700, dom.windrose700, wd700, ws700);

    // Windscherung prüfen (inkl. 900hPa)
    const normalizedDifference = (a, b) => {
        if (a === null || b === null) return null;
        const difference = Math.abs(a - b);
        return difference > 180 ? 360 - difference : difference;
    };
    const norm900 = normalizedDifference(wdSurface, wd900);
    const norm850 = normalizedDifference(wdSurface, wd850);
    const norm700 = normalizedDifference(wdSurface, wd700);
    if ((norm900 !== null && norm900 > 30 && ws900 > 12) ||
        (norm850 !== null && norm850 > 45 && ws850 > 15) ||
        (norm700 !== null && norm700 > 60 && ws700 > 20)) {
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
    if (state.hourlyWeather.length > 0 && state.selectedHourIndex !== null && state.forecastDays?.length > 0) {
        rebuildHourlyAssessments();
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
    if (state.hourlyWeather.length > 0 && state.selectedHourIndex !== null && state.forecastDays?.length > 0) {
        rebuildHourlyAssessments();
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
    if (state.hourlyWeather.length > 0 && state.selectedHourIndex !== null && state.forecastDays?.length > 0) {
        rebuildHourlyAssessments();
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
            hint.textContent = 'Eigene Komfortgrenzen; kritische Indikatoren bleiben unabhängig.';
            hint.classList.remove('active');
        } else if (state.customLimits) {
            // Zähle geänderte Parameter
            const changes = countCustomChanges();
            hint.textContent = `✓ ${changes} Komfortparameter angepasst; kritische Indikatoren bleiben unabhängig.`;
            hint.classList.add('active');
        } else {
            hint.textContent = 'Komfortgrenzen anpassen; kritische Indikatoren bleiben unabhängig.';
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
    if (state.customLimits.wind?.directionShear?.yellow !== 60) count++;
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
    setInputValue('expertDirectionShear', currentLimits.wind?.directionShear?.yellow, 60);
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
 * Speichert die Expertenmodus-Einstellungen
 */
export function saveExpertSettings() {
    // Gelb-Schwellen aus Formular lesen
    const windSurfaceYellow = getInputNumber('expertWindSurface', LIMITS.wind.surface.yellow);
    const windGustsYellow = getInputNumber('expertWindGusts', LIMITS.wind.gusts.yellow);
    const gustSpreadYellow = getInputNumber('expertGustSpread', LIMITS.wind.gustSpread.yellow);
    const gradientYellow = getInputNumber('expertGradient', LIMITS.wind.gradient.yellow);
    const directionShearYellow = getInputNumber('expertDirectionShear', 60);
    const w900Yellow = getInputNumber('expertWind900', LIMITS.wind.w900.yellow);
    const w850Yellow = getInputNumber('expertWind850', LIMITS.wind.w850.yellow);
    const w700Yellow = getInputNumber('expertWind700', LIMITS.wind.w700.yellow);
    const capeYellow = getInputNumber('expertCape', LIMITS.cape.yellow);
    const cloudLowYellow = getInputNumber('expertCloudLow', LIMITS.clouds.low.yellow);
    const visibilityGreen = getInputNumber('expertVisibility', LIMITS.visibility.green);
    const precipYellow = getInputNumber('expertPrecip', LIMITS.precip.yellow);
    const precipProbYellow = getInputNumber('expertPrecipProb', LIMITS.precipProb.yellow);

    const customLimits = buildCustomLimits({
        windSurface: windSurfaceYellow,
        windGusts: windGustsYellow,
        gustSpread: gustSpreadYellow,
        gradient: gradientYellow,
        directionShear: directionShearYellow,
        w900: w900Yellow,
        w850: w850Yellow,
        w700: w700Yellow,
        cape: capeYellow,
        cloudLow: cloudLowYellow,
        visibility: visibilityGreen,
        precip: precipYellow,
        precipProb: precipProbYellow
    });

    state.customLimits = customLimits;
    saveExpertMode();
    updateExpertModeUI();
    closeExpertSettings();

    // Anzeige aktualisieren
    if (state.hourlyWeather.length > 0 && state.selectedHourIndex !== null && state.forecastDays?.length > 0) {
        rebuildHourlyAssessments();
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
    setInputValue('expertDirectionShear', preset.values.directionShear, 60);
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
 * Öffnet das Welcome-Modal
 */
export function openWelcomeModal() {
    const modal = document.getElementById('welcomeModal');
    if (modal) {
        modal.classList.add('visible');
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Schließt das Welcome-Modal und setzt Onboarding-Flag
 */
export function closeWelcomeModal() {
    const modal = document.getElementById('welcomeModal');
    if (modal) {
        modal.classList.remove('visible');
        document.body.style.overflow = '';
    }
    try {
        localStorage.setItem(STORAGE_KEYS.ONBOARDING_DONE, '1');
    } catch (e) {
        // localStorage nicht verfügbar
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
    if (!grid || state.hourlyWeather.length === 0) return;

    // Tag-Hinweis im Diagramm-Header
    const diagramDayHint = document.getElementById('windDiagramDayHint');
    if (diagramDayHint) {
        const d = new Date(dayStr);
        const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
        // today/tomorrow aus forecastDays (lokale Zeitzone des Orts) ableiten, nicht aus UTC
        const today = state.forecastDays[0]?.date;
        const tomorrow = state.forecastDays[1]?.date;
        let label;
        if (dayStr === today) label = 'Heute';
        else if (dayStr === tomorrow) label = 'Morgen';
        else label = dayNames[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.';
        diagramDayHint.textContent = label;
    }

    grid.innerHTML = '';
    xAxis.innerHTML = '';

    const times = state.hourlyWeather.map(hour => hour.time);

    // Höhenlevel von oben nach unten (700hPa = 3000m ist oben)
    const levels = [
        { key: '700', pressureHpa: 700, label: '3000m' },
        { key: '800', pressureHpa: 800, label: '2000m' },
        { key: '850', pressureHpa: 850, label: '1500m' },
        { key: '900', pressureHpa: 900, label: '1000m' },
        { key: 'ground', pressureHpa: null, label: 'Boden' }
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
            const hourData = state.hourlyWeather[idx];
            const pressureData = level.pressureHpa === null
                ? null
                : hourData.wind.levels.find(item => item.pressureHpa === level.pressureHpa);
            const speedData = level.pressureHpa === null
                ? hourData.surface.windSpeedKmh
                : pressureData?.speedKmh;
            const dirData = level.pressureHpa === null
                ? hourData.surface.windDirectionDeg
                : pressureData?.directionDeg;
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




/**
 * Preset-Profile für Expertenmodus
 */
