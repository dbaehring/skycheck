/**
 * SkyCheck - Favoriten-Modul
 * Favoriten-Verwaltung mit localStorage
 */

import { state } from './state.js';
import { STORAGE_KEYS, LIMITS } from './config.js';
import { isInIconEUCoverage, escapeHtml } from './utils.js';
import { selectLocation } from './map.js';

// Rate limiting: Verzögerung zwischen API-Calls (ms)
const API_DELAY = 200;

/**
 * Favoriten aus localStorage laden
 */
export function loadFavorites() {
    try {
        state.favorites = JSON.parse(localStorage.getItem(STORAGE_KEYS.FAVORITES) || '[]');
    } catch(e) {
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

/**
 * Nur UI aktualisieren, ohne erneuten Wetter-Fetch
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

    // Event-Listener für Favoriten-Buttons
    container.querySelectorAll('.favorite-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Nicht auslösen wenn Delete geklickt wurde
            if (e.target.classList.contains('delete-fav')) return;
            const idx = parseInt(btn.dataset.favIdx);
            selectFavorite(idx);
        });
    });

    // Event-Listener für Delete-Buttons
    container.querySelectorAll('.delete-fav').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.deleteIdx);
            deleteFavorite(idx);
        });
    });
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
        }, 2000);
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
 * Wetterdaten für alle Favoriten im Hintergrund laden (mit Rate Limiting)
 */
async function fetchAllFavoriteWeather() {
    for (const f of state.favorites) {
        const key = f.lat.toFixed(4) + ',' + f.lon.toFixed(4);
        if (!state.favoriteWeatherCache[key]) {
            await fetchQuickWeather(f.lat, f.lon, key);
            // Rate limiting: Kurze Pause zwischen API-Calls
            await new Promise(resolve => setTimeout(resolve, API_DELAY));
        }
    }
}

/**
 * Schnelle Wetter-Abfrage für einen Favoriten
 */
async function fetchQuickWeather(lat, lon, cacheKey) {
    try {
        // icon_seamless wählt automatisch ICON-D2 > ICON-EU > ICON-Global
        const inEU = isInIconEUCoverage(lat, lon);
        const model = inEU ? 'icon_seamless' : 'best_match';
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
            '&hourly=wind_speed_10m,wind_gusts_10m,cape&models=' + model + '&forecast_days=1&timezone=auto';

        const response = await fetch(url);
        const data = await response.json();

        // Analysiere die nächsten Stunden (6-20 Uhr heute)
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        let bestScore = 1, bestWindow = null, currentWindow = null;

        for (let h = 6; h <= 20; h++) {
            const ts = todayStr + 'T' + h.toString().padStart(2, '0') + ':00';
            const idx = data.hourly.time.findIndex(t => t === ts);
            if (idx === -1) continue;

            const ws = data.hourly.wind_speed_10m[idx] || 0;
            const wg = data.hourly.wind_gusts_10m[idx] || 0;
            const cape = data.hourly.cape?.[idx] || 0;

            // Scoring-Logik (Schwellenwerte aus LIMITS, konsistent mit getHourScore)
            let score = 3;
            if (ws > LIMITS.wind.surface.yellow || wg > LIMITS.wind.gusts.yellow || cape > LIMITS.cape.yellow) score = 1;
            else if (ws > LIMITS.wind.surface.green || wg > LIMITS.wind.gusts.green || cape > LIMITS.cape.green) score = 2;

            if (score >= bestScore) bestScore = score;
            if (score === 3) {
                if (!currentWindow) currentWindow = { start: h, end: h };
                else currentWindow.end = h;
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
        const labelMap = { 3: 'GO', 2: 'Prüfen', 1: 'No-Go' };
        let info = labelMap[bestScore];
        if (bestWindow && bestScore >= 2) {
            info += ' ' + bestWindow.start + '-' + bestWindow.end + 'h';
        }

        state.favoriteWeatherCache[cacheKey] = { status: statusMap[bestScore], info: info };
        renderFavoritesUI();
    } catch (e) {
        state.favoriteWeatherCache[cacheKey] = { status: 'caution', info: 'Fehler' };
        renderFavoritesUI();
    }
}
