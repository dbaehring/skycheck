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
    if (ws < 5) return 0; // Bei sehr schwachem Wind nicht relevant
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
 * Legacy-Funktion für Rückwärtskompatibilität
 */
export function isInIconCoverage(lat, lon) {
    return isInIconEUCoverage(lat, lon);
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
