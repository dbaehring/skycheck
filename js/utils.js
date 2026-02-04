/**
 * SkyCheck - Hilfsfunktionen
 * Utility-Funktionen für Berechnungen und Formatierungen
 */

import { WEATHER_CODES, LIMITS } from './config.js';

/**
 * Windrichtung in Textform (N, NO, O, etc.)
 */
export function getWindDir(d) {
    const dirs = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(d / 22.5) % 16];
}

/**
 * Farbklasse basierend auf Grenzwerten (normal: niedrig=gut)
 */
export function getColorClass(v, l) {
    return v <= l.green ? 'green' : v <= l.yellow ? 'yellow' : 'red';
}

/**
 * Farbklasse invertiert (für Parameter wo höher=besser, z.B. Sichtweite)
 */
export function getColorClassRev(v, l) {
    return v >= l.green ? 'green' : v >= l.yellow ? 'yellow' : 'red';
}

/**
 * Spread-Farbklasse (spezielle Logik)
 */
export function getSpreadColor(s) {
    if (s === null || s === undefined) return 'green'; // Bei fehlenden Daten neutral
    return s < LIMITS.spread.min ? 'red' : (s < LIMITS.spread.optimalMin || s > LIMITS.spread.max) ? 'yellow' : 'green';
}

/**
 * Score zu Farbklasse
 */
export function scoreToColor(s) {
    return s === 3 ? 'go' : s === 2 ? 'caution' : 'nogo';
}

/**
 * Trend-Indikator (Vergleich mit vorheriger Stunde)
 */
export function getTrend(cur, prev) {
    if (prev == null) return { symbol: '', cls: 'stable' };
    const d = cur - prev;
    if (Math.abs(d) < 1) return { symbol: '→', cls: 'stable' };
    return d > 0 ? { symbol: '↑', cls: 'up' } : { symbol: '↓', cls: 'down' };
}

/**
 * Böenfaktor berechnen
 * PHASE 1 SAFETY: Gust-Faktor Berechnung
 */
export function getGustFactor(ws, wg) {
    if (!ws || ws <= 0 || ws < 5) return 0; // Bei sehr schwachem/keinem Wind nicht relevant
    return (wg - ws) / ws;
}

/**
 * Wetter-Info aus Code holen
 * v8 NEU: Wetter-Codes für Symbole
 */
export function getWeatherInfo(code) {
    return WEATHER_CODES[code] || { icon: '❓', text: 'Unbekannt' };
}

/**
 * Prüfe ob Koordinaten in ICON-D2 Abdeckung liegen
 * ICON-D2: Deutschland, Benelux, Schweiz, Österreich, Teile der Nachbarländer
 * Auflösung: 2.2km, Vorhersage: 48h
 */
export function isInIconD2Coverage(lat, lon) {
    // ICON-D2 Kerngebiet: ~47-55°N, 5-15°E (Mitteleuropa)
    return lat >= 45.5 && lat <= 55.5 && lon >= 4.5 && lon <= 17.0;
}

/**
 * Prüfe ob Koordinaten in ICON-EU Abdeckung liegen
 * ICON-EU: Europa
 * Auflösung: 7km, Vorhersage: 5 Tage
 */
export function isInIconEUCoverage(lat, lon) {
    // ICON-EU deckt Europa ab: Lat 30-75, Lon -25-45
    return lat >= 30 && lat <= 75 && lon >= -25 && lon <= 45;
}

/**
 * PHASE 3 Aufgabe 2: Prüfe ob Standort in Alpennähe ist (für Föhn-Check)
 */
export function isInAlpineRegion(lat, lon) {
    // Methode 1: Bounding Box der Alpen
    const inBoundingBox = lat >= 45.5 && lat <= 47.8 && lon >= 6.0 && lon <= 16.0;
    if (inBoundingBox) return true;

    // Methode 2: Distanz zu Alpenzentrum < 200km
    const alpsCenterLat = 47.0, alpsCenterLon = 11.5;
    const R = 6371; // Erdradius in km
    const dLat = (lat - alpsCenterLat) * Math.PI / 180;
    const dLon = (lon - alpsCenterLon) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(alpsCenterLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;

    return distance < 200;
}

/**
 * Formatiere Zeit (HH:MM)
 */
export function formatTime(dateStr) {
    const d = new Date(dateStr);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

/**
 * XSS-Schutz: Escaped HTML-Sonderzeichen in Strings
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Validiert customLimits aus localStorage gegen erwartetes Schema
 * @param {Object} limits - Die zu validierenden Limits
 * @returns {Object|null} Validierte Limits oder null wenn ungültig
 */
export function validateCustomLimits(limits) {
    if (!limits || typeof limits !== 'object') {
        return null;
    }

    // Erwartete Struktur mit erlaubten Bereichen
    const schema = {
        wind: {
            surface: { min: 0, max: 50 },
            gusts: { min: 0, max: 80 },
            w900: { min: 0, max: 60 },
            w850: { min: 0, max: 60 },
            w800: { min: 0, max: 70 },
            w700: { min: 0, max: 80 },
            gradient: { min: 0, max: 50 }
        },
        cape: { min: 0, max: 5000 },
        visibility: { min: 100, max: 50000 }
    };

    // Validierungsfunktion für einzelne Werte
    const isValidNumber = (val, min, max) => {
        return typeof val === 'number' && !isNaN(val) && val >= min && val <= max;
    };

    // Rekursive Validierung
    const validateObject = (obj, schemaObj) => {
        if (!obj || typeof obj !== 'object') return false;
        for (const key of Object.keys(schemaObj)) {
            if (obj[key] === undefined) continue; // Optionale Felder
            const spec = schemaObj[key];
            if (spec.min !== undefined && spec.max !== undefined) {
                // Endknoten mit green/yellow
                if (obj[key].green !== undefined && !isValidNumber(obj[key].green, spec.min, spec.max)) {
                    return false;
                }
                if (obj[key].yellow !== undefined && !isValidNumber(obj[key].yellow, spec.min, spec.max)) {
                    return false;
                }
            } else if (typeof spec === 'object') {
                // Verschachteltes Objekt
                if (!validateObject(obj[key], spec)) return false;
            }
        }
        return true;
    };

    // Validiere nur wenn wind-Objekt vorhanden
    if (limits.wind && !validateObject(limits, schema)) {
        console.warn('customLimits Schema-Validierung fehlgeschlagen');
        return null;
    }

    return limits;
}

/**
 * Zentrale Error-Handling Funktion
 * Vereinheitlicht Fehlerbehandlung und Logging
 * @param {Error|string} error - Fehler-Objekt oder Nachricht
 * @param {string} context - Kontext wo der Fehler auftrat (z.B. 'Wetterdaten laden')
 * @param {Object} options - Optionale Einstellungen
 * @param {boolean} options.silent - Wenn true, kein console.error
 * @param {boolean} options.showToast - Wenn true, Toast-Nachricht anzeigen
 * @param {string} options.level - 'error', 'warn', 'info' (default: 'error')
 */
export function handleError(error, context, options = {}) {
    const { silent = false, showToast = false, level = 'error' } = options;
    const message = error instanceof Error ? error.message : String(error);
    const fullMessage = `${context}: ${message}`;

    // Logging (falls nicht silent)
    if (!silent) {
        if (level === 'warn') {
            console.warn(fullMessage);
        } else if (level === 'info') {
            console.info(fullMessage);
        } else {
            console.error(fullMessage);
        }
    }

    // Toast anzeigen (falls gewünscht und showToast verfügbar)
    if (showToast && typeof window !== 'undefined') {
        // Dynamischer Import vermeiden - Toast wird von aufrufendem Code gehandhabt
        return { message: fullMessage, level };
    }

    return { message: fullMessage, level };
}

/**
 * Registriert Standard-Schließverhalten für ein Modal
 * Schließt bei Klick auf Overlay (außerhalb des Inhalts)
 * @param {string} modalId - ID des Modal-Elements
 * @param {Function} closeCallback - Funktion zum Schließen des Modals
 * @param {string} [closeBtnId] - Optionale ID des Schließen-Buttons
 */
export function setupModalClose(modalId, closeCallback, closeBtnId = null) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Schließen bei Klick auf Overlay
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeCallback();
        }
    });

    // Optionaler Schließen-Button
    if (closeBtnId) {
        const closeBtn = document.getElementById(closeBtnId);
        if (closeBtn) {
            closeBtn.addEventListener('click', closeCallback);
        }
    }
}
