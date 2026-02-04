/**
 * SkyCheck - Favoriten-Modul
 * Favoriten-Verwaltung mit localStorage
 */

import { state } from './state.js';
import { STORAGE_KEYS, LIMITS, UI_CONFIG, CACHE_CONFIG } from './config.js';
import { isInIconEUCoverage, escapeHtml } from './utils.js';
import { selectLocation } from './map.js';
import { extractWindData } from './weather.js';

// Rate limiting: Verzögerung zwischen API-Calls (ms)
const API_DELAY = 200;

/**
 * Favoriten-Wetter-Cache aus localStorage laden
 * Entfernt abgelaufene Einträge automatisch
 */
export function loadFavoriteWeatherCache() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.FAVORITES_WEATHER_CACHE);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return;

        const now = Date.now();
        const validEntries = {};

        // Nur nicht-abgelaufene Einträge behalten
        for (const [key, entry] of Object.entries(parsed)) {
            if (entry && entry.timestamp && (now - entry.timestamp) < CACHE_CONFIG.favoriteWeatherTTL) {
                validEntries[key] = entry;
            }
        }

        state.favoriteWeatherCache = validEntries;

        // Cache aufräumen wenn Einträge entfernt wurden
        if (Object.keys(validEntries).length !== Object.keys(parsed).length) {
            saveFavoriteWeatherCache();
        }
    } catch (e) {
        console.warn('Fehler beim Laden des Favoriten-Wetter-Cache:', e);
        state.favoriteWeatherCache = {};
    }
}

/**
 * Favoriten-Wetter-Cache in localStorage speichern
 */
function saveFavoriteWeatherCache() {
    try {
        localStorage.setItem(
            STORAGE_KEYS.FAVORITES_WEATHER_CACHE,
            JSON.stringify(state.favoriteWeatherCache)
        );
    } catch (e) {
        console.warn('Fehler beim Speichern des Favoriten-Wetter-Cache:', e);
    }
}

/**
 * Validiert ein Favoriten-Objekt
 * @param {*} fav - Zu validierendes Objekt
 * @returns {boolean} true wenn gültig
 */
function isValidFavorite(fav) {
    return fav &&
           typeof fav === 'object' &&
           typeof fav.lat === 'number' && isFinite(fav.lat) && fav.lat >= -90 && fav.lat <= 90 &&
           typeof fav.lon === 'number' && isFinite(fav.lon) && fav.lon >= -180 && fav.lon <= 180 &&
           typeof fav.name === 'string' && fav.name.length > 0 && fav.name.length <= 100 &&
           (fav.elevation === undefined || (typeof fav.elevation === 'number' && isFinite(fav.elevation)));
}

/**
 * Favoriten aus localStorage laden (mit Schema-Validierung)
 */
export function loadFavorites() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.FAVORITES);
        if (!raw) {
            state.favorites = [];
            return;
        }

        const parsed = JSON.parse(raw);

        // Muss ein Array sein
        if (!Array.isArray(parsed)) {
            console.warn('Favoriten-Daten ungültig (kein Array), wird zurückgesetzt');
            state.favorites = [];
            return;
        }

        // Nur gültige Favoriten behalten
        const validFavorites = parsed.filter(fav => {
            const valid = isValidFavorite(fav);
            if (!valid) {
                console.warn('Ungültiger Favorit entfernt:', fav);
            }
            return valid;
        });

        // Wenn Favoriten entfernt wurden, Storage aktualisieren
        if (validFavorites.length !== parsed.length) {
            localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(validFavorites));
        }

        state.favorites = validFavorites;
    } catch(e) {
        console.error('Fehler beim Laden der Favoriten:', e);
        state.favorites = [];
    }
}

/**
 * Favoriten in localStorage speichern
 */
export function saveFavoritesToStorage() {
    try {
        localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(state.favorites));
    } catch (e) {
        console.warn('localStorage quota exceeded:', e);
        // Optional: Älteste Favoriten entfernen wenn Speicher voll
    }
}

/**
 * Favoriten rendern (mit Status-Ampeln)
 */
export function renderFavorites() {
    const section = document.getElementById('favoritesSection');
    const container = document.getElementById('favoritesButtons');

    if (state.favorites.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    renderFavoritesUI();

    // Lade Wetterdaten für alle Favoriten im Hintergrund
    fetchAllFavoriteWeather();
}

// Flag um Event-Delegation nur einmal zu registrieren
let favoritesListenerRegistered = false;

/**
 * Nur UI aktualisieren, ohne erneuten Wetter-Fetch
 * Verwendet Event-Delegation statt individueller Listener (Performance-Optimierung)
 */
export function renderFavoritesUI() {
    const container = document.getElementById('favoritesButtons');
    if (!container || state.favorites.length === 0) return;

    container.innerHTML = state.favorites.map((f, idx) => {
        const key = f.lat.toFixed(4) + ',' + f.lon.toFixed(4);
        const cached = state.favoriteWeatherCache[key];
        let statusClass = 'loading', quickInfo = 'Lade...';
        if (cached) {
            statusClass = cached.status;
            quickInfo = cached.info;
        }
        // XSS-Schutz: User-Input escapen
        const safeName = escapeHtml(f.name);
        const safeInfo = escapeHtml(quickInfo);
        return `<button class="favorite-btn" data-fav-idx="${idx}">
            <span class="fav-status ${statusClass}"></span>
            ${safeName}
            <span class="fav-quick-info">${safeInfo}</span>
            <span class="delete-fav" data-delete-idx="${idx}">×</span>
        </button>`;
    }).join('');

    // Event-Delegation: Listener nur einmal am Container registrieren
    if (!favoritesListenerRegistered) {
        container.addEventListener('click', handleFavoriteClick);
        favoritesListenerRegistered = true;
    }
}

/**
 * Event-Handler für Favoriten-Klicks (Event-Delegation)
 */
function handleFavoriteClick(e) {
    // Delete-Button geklickt
    if (e.target.classList.contains('delete-fav')) {
        e.stopPropagation();
        const idx = parseInt(e.target.dataset.deleteIdx);
        if (!isNaN(idx)) deleteFavorite(idx);
        return;
    }

    // Favoriten-Button geklickt
    const btn = e.target.closest('.favorite-btn');
    if (btn) {
        const idx = parseInt(btn.dataset.favIdx);
        if (!isNaN(idx)) selectFavorite(idx);
    }
}

/**
 * Favorit auswählen
 */
export function selectFavorite(idx) {
    const f = state.favorites[idx];
    if (f) {
        selectLocation(f.lat, f.lon, f.elevation, f.name);
    }
}

// Temporärer Index für Lösch-Bestätigung
let pendingDeleteIdx = null;

/**
 * Favorit löschen (mit Custom-Modal statt confirm())
 */
export function deleteFavorite(idx) {
    pendingDeleteIdx = idx;
    const modal = document.getElementById('confirmModal');
    const text = document.getElementById('confirmModalText');
    const fav = state.favorites[idx];
    text.textContent = `Möchtest du "${fav?.name || 'diesen Favoriten'}" wirklich löschen?`;
    modal.classList.add('visible');
}

/**
 * Löschen bestätigen
 */
export function confirmDelete() {
    if (pendingDeleteIdx !== null) {
        state.favorites.splice(pendingDeleteIdx, 1);
        saveFavoritesToStorage();
        renderFavorites();
        pendingDeleteIdx = null;
    }
    closeConfirmModal();
}

/**
 * Bestätigungs-Modal schließen
 */
export function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('visible');
    pendingDeleteIdx = null;
}

/**
 * Modal zum Favoriten-Speichern öffnen
 */
export function openFavoriteModal() {
    if (!state.currentLocation.lat) return;
    document.getElementById('favoriteNameInput').value = state.currentLocation.name || '';
    document.getElementById('favoriteModal').classList.add('visible');
    document.getElementById('favoriteNameInput').focus();
}

/**
 * Modal schließen
 */
export function closeFavoriteModal() {
    document.getElementById('favoriteModal').classList.remove('visible');
}

/**
 * Favorit speichern
 */
export function saveFavorite() {
    const input = document.getElementById('favoriteNameInput');
    const name = input.value.trim();
    if (!name) {
        // Visuelles Feedback statt alert()
        input.style.borderColor = 'var(--red)';
        input.placeholder = 'Name ist erforderlich!';
        input.focus();
        setTimeout(() => {
            input.style.borderColor = '';
            input.placeholder = 'Name eingeben...';
        }, UI_CONFIG.inputFeedbackDuration);
        return;
    }

    state.favorites.push({
        lat: state.currentLocation.lat,
        lon: state.currentLocation.lon,
        elevation: state.currentLocation.elevation,
        name: name
    });

    saveFavoritesToStorage();
    renderFavorites();
    closeFavoriteModal();
}

// PHASE 3 Aufgabe 4: Schnell-Wetterdaten für Favoriten laden

/**
 * Prüft ob ein Cache-Eintrag noch gültig ist
 */
function isCacheValid(cacheEntry) {
    if (!cacheEntry || !cacheEntry.timestamp) return false;
    return (Date.now() - cacheEntry.timestamp) < CACHE_CONFIG.favoriteWeatherTTL;
}

// Batch-Konfiguration
const BATCH_SIZE = 5;  // Max. parallele API-Calls

/**
 * Wetterdaten für alle Favoriten im Hintergrund laden (Batch-Rendering)
 * - Lädt in Batches von BATCH_SIZE parallelen Requests
 * - Rendert nur einmal pro Batch (statt nach jedem einzelnen Request)
 */
async function fetchAllFavoriteWeather() {
    // Sammle alle Favoriten die einen Fetch brauchen
    const toFetch = state.favorites
        .map(f => ({
            lat: f.lat,
            lon: f.lon,
            key: f.lat.toFixed(4) + ',' + f.lon.toFixed(4)
        }))
        .filter(f => !isCacheValid(state.favoriteWeatherCache[f.key]));

    if (toFetch.length === 0) return;

    // In Batches aufteilen und parallel fetchen
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
        const batch = toFetch.slice(i, i + BATCH_SIZE);

        // Alle Requests im Batch parallel starten
        await Promise.all(
            batch.map(f => fetchQuickWeather(f.lat, f.lon, f.key))
        );

        // Nach jedem Batch einmal rendern (nicht nach jedem einzelnen Request)
        renderFavoritesUI();

        // Kurze Pause zwischen Batches (Rate Limiting)
        if (i + BATCH_SIZE < toFetch.length) {
            await new Promise(resolve => setTimeout(resolve, API_DELAY));
        }
    }

    // Cache einmal am Ende speichern
    saveFavoriteWeatherCache();
}

/**
 * Vollständige Wetter-Abfrage für einen Favoriten (konsistent mit Hauptampel)
 */
async function fetchQuickWeather(lat, lon, cacheKey) {
    try {
        // icon_seamless wählt automatisch ICON-D2 > ICON-EU > ICON-Global
        const inEU = isInIconEUCoverage(lat, lon);
        const model = inEU ? 'icon_seamless' : 'best_match';
        // Vollständige Parameter wie bei Hauptampel
        const params = [
            'wind_speed_10m', 'wind_gusts_10m',
            'wind_speed_900hPa', 'wind_speed_850hPa', 'wind_speed_800hPa', 'wind_speed_700hPa',
            'temperature_2m', 'dew_point_2m',
            'cape', 'lifted_index',
            'cloud_cover', 'cloud_cover_low', 'visibility',
            'precipitation', 'precipitation_probability', 'showers'
        ].join(',');
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${params}&models=${model}&forecast_days=1&timezone=auto`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const h = data.hourly;

        // Analysiere die nächsten Stunden (6-20 Uhr heute)
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        let worstScore = 3, bestWindow = null, currentWindow = null;

        for (let hour = 6; hour <= 20; hour++) {
            const ts = todayStr + 'T' + hour.toString().padStart(2, '0') + ':00';
            const idx = h.time.findIndex(t => t === ts);
            if (idx === -1) continue;

            // Alle Parameter extrahieren (zentrale Helper-Funktion)
            const wind = extractWindData(h, idx);
            const { ws, wg, w900, w850, w800, w700, grad, grad3000, gustSpread } = wind;

            const temp = h.temperature_2m?.[idx];
            const dew = h.dew_point_2m?.[idx];
            const spread = (temp != null && dew != null) ? temp - dew : 10;
            const cape = h.cape?.[idx] || 0;
            const li = h.lifted_index?.[idx] || 0;

            const vis = h.visibility?.[idx] || 50000;
            const cloudLow = h.cloud_cover_low?.[idx] || 0;
            const cloudTotal = h.cloud_cover?.[idx] || 0;

            const precip = h.precipitation?.[idx] || 0;
            const precipProb = h.precipitation_probability?.[idx] || 0;
            const showers = h.showers?.[idx] || 0;

            // Scoring-Logik (identisch mit getHourScore)
            let score = 3;

            // NO-GO Kriterien (Score 1)
            if (ws > LIMITS.wind.surface.yellow || wg > LIMITS.wind.gusts.yellow ||
                gustSpread > LIMITS.wind.gustSpread.yellow ||
                w900 > LIMITS.wind.w900.yellow || w850 > LIMITS.wind.w850.yellow ||
                w800 > LIMITS.wind.w800.yellow || w700 > LIMITS.wind.w700.yellow ||
                grad > LIMITS.wind.gradient.yellow || grad3000 > LIMITS.wind.gradient3000.yellow) {
                score = 1;
            } else if (spread < LIMITS.fog.spreadSevere || cape > LIMITS.cape.yellow || li < LIMITS.liftedIndex.yellow) {
                score = 1;
            } else if (cloudLow > LIMITS.clouds.low.yellow || vis < LIMITS.visibility.yellow) {
                score = 1;
            } else if (precip > LIMITS.precip.yellow || showers > LIMITS.showers.yellow) {
                score = 1;
            }
            // VORSICHT Kriterien (Score 2)
            else if (ws > LIMITS.wind.surface.green || wg > LIMITS.wind.gusts.green ||
                gustSpread > LIMITS.wind.gustSpread.green ||
                w900 > LIMITS.wind.w900.green || w850 > LIMITS.wind.w850.green ||
                w800 > LIMITS.wind.w800.green || w700 > LIMITS.wind.w700.green ||
                grad > LIMITS.wind.gradient.green || grad3000 > LIMITS.wind.gradient3000.green) {
                score = 2;
            } else if (spread < LIMITS.fog.spreadWarning || cape > LIMITS.cape.green || li < LIMITS.liftedIndex.green) {
                score = 2;
            } else if (cloudTotal > LIMITS.clouds.total.yellow || cloudLow > LIMITS.clouds.low.green || vis < LIMITS.visibility.green) {
                score = 2;
            } else if (precip > LIMITS.precip.green || precipProb > LIMITS.precipProb.yellow || showers > LIMITS.showers.green) {
                score = 2;
            }

            // Schlechtesten Score tracken
            if (score < worstScore) worstScore = score;

            // Grüne Fenster tracken
            if (score === 3) {
                if (!currentWindow) currentWindow = { start: hour, end: hour };
                else currentWindow.end = hour;
            } else {
                if (currentWindow && (!bestWindow || (currentWindow.end - currentWindow.start) > (bestWindow.end - bestWindow.start))) {
                    bestWindow = currentWindow;
                }
                currentWindow = null;
            }
        }
        if (currentWindow && (!bestWindow || (currentWindow.end - currentWindow.start) > (bestWindow.end - bestWindow.start))) {
            bestWindow = currentWindow;
        }

        const statusMap = { 3: 'go', 2: 'caution', 1: 'nogo' };
        const labelMap = { 3: 'GO', 2: 'Vorsicht', 1: 'No-Go' };
        let info = labelMap[worstScore];
        if (bestWindow) {
            info += ' ' + bestWindow.start + '-' + bestWindow.end + 'h';
        } else if (worstScore === 1) {
            info += ' (kein Fenster)';
        }

        state.favoriteWeatherCache[cacheKey] = {
            status: statusMap[worstScore],
            info: info,
            timestamp: Date.now()
        };
    } catch (e) {
        state.favoriteWeatherCache[cacheKey] = {
            status: 'caution',
            info: 'Fehler',
            timestamp: Date.now()
        };
    }
}

/**
 * Öffnet das Vergleichs-Modal
 */
export function openCompareModal() {
    const modal = document.getElementById('compareModal');
    if (!modal || state.favorites.length === 0) return;

    renderCompareGrid();
    modal.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

/**
 * Schließt das Vergleichs-Modal
 */
export function closeCompareModal() {
    const modal = document.getElementById('compareModal');
    if (modal) {
        modal.classList.remove('visible');
        document.body.style.overflow = '';
    }
}

/**
 * Rendert das Vergleichs-Grid
 */
function renderCompareGrid() {
    const grid = document.getElementById('compareGrid');
    if (!grid) return;

    const statusLabels = {
        go: 'GO',
        caution: 'VORSICHT',
        nogo: 'NO-GO',
        loading: 'Lädt...'
    };

    grid.innerHTML = state.favorites.map((f, idx) => {
        const key = f.lat.toFixed(4) + ',' + f.lon.toFixed(4);
        const cached = state.favoriteWeatherCache[key];
        const status = cached?.status || 'loading';
        const info = cached?.info || 'Lade Wetterdaten...';
        const safeName = escapeHtml(f.name);
        const safeInfo = escapeHtml(info);

        return `
            <div class="compare-card ${status}" data-fav-idx="${idx}">
                <div class="compare-card-header">
                    <span class="compare-card-status ${status}"></span>
                    <span class="compare-card-name">${safeName}</span>
                </div>
                <div class="compare-card-info">${safeInfo}</div>
                <span class="compare-card-label ${status}">${statusLabels[status]}</span>
            </div>
        `;
    }).join('');

    // Click-Handler für Karten
    grid.querySelectorAll('.compare-card').forEach(card => {
        card.addEventListener('click', () => {
            const idx = parseInt(card.dataset.favIdx);
            if (!isNaN(idx)) {
                closeCompareModal();
                selectFavorite(idx);
            }
        });
    });
}
