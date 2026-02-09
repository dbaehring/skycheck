/**
 * SkyCheck - Karten-Modul
 * Leaflet-Karte, Marker, GPS-Funktionen
 */

import { state } from './state.js';
import { API_CONFIG, UI_CONFIG } from './config.js';
import { showToast } from './ui.js';

// Callback für Wetter-Laden (wird von main.js gesetzt)
let onLocationSelected = null;

/**
 * Callback registrieren für Standort-Auswahl
 */
export function setLocationCallback(callback) {
    onLocationSelected = callback;
}

/**
 * Karte initialisieren
 */
export function initMap() {
    state.map = L.map('map', {
        center: [47.3, 11.0],
        zoom: 8,
        zoomControl: false,
        // tap: true entfernt - verursacht auf modernen Browsern Doppelklick-Probleme
        dragging: true,       // Karte bewegbar
        touchZoom: true,      // Pinch-Zoom erlaubt
        scrollWheelZoom: true,
        doubleClickZoom: true
    });

    // Zoom-Control unten rechts platzieren (weniger Überlappung auf Mobile)
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: 'Kartendaten: © <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>-Mitwirkende, <a href="https://viewfinderpanoramas.org" target="_blank" rel="noopener noreferrer">SRTM</a> | Kartendarstellung: © <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC-BY-SA</a>)'
    }).addTo(state.map);
    state.map.on('click', async (e) => await handleMapClick(e.latlng.lat, e.latlng.lng));
}

/**
 * Klick auf Karte verarbeiten
 */
export async function handleMapClick(lat, lon, customName = null) {
    updateMarker(lat, lon);
    document.getElementById('coordsDisplay').textContent = lat.toFixed(4) + '°N, ' + lon.toFixed(4) + '°E';

    let elevation = await getElevation(lat, lon);
    state.currentLocation = {
        lat,
        lon,
        elevation,
        name: customName || (lat.toFixed(3) + '°N, ' + lon.toFixed(3) + '°E')
    };

    updateURL();
    document.getElementById('shareBtn').disabled = false;
    document.getElementById('addFavoriteBtn').disabled = false;

    if (onLocationSelected) {
        await onLocationSelected();
    }
}

/**
 * Standort auswählen (von Favoriten)
 */
export async function selectLocation(lat, lon, elevation, name) {
    updateMarker(lat, lon);
    state.map.setView([lat, lon], 11);
    document.getElementById('coordsDisplay').textContent = lat.toFixed(4) + '°N, ' + lon.toFixed(4) + '°E';

    state.currentLocation = { lat, lon, elevation, name };

    updateURL();
    document.getElementById('shareBtn').disabled = false;
    document.getElementById('addFavoriteBtn').disabled = false;

    if (onLocationSelected) {
        await onLocationSelected();
    }
}

/**
 * Marker aktualisieren oder erstellen
 */
export function updateMarker(lat, lon) {
    if (state.marker) {
        state.marker.setLatLng([lat, lon]);
    } else {
        state.marker = L.marker([lat, lon], {
            icon: L.divIcon({
                className: 'custom-marker',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(state.map);
    }
}

/**
 * Karte zu Position fliegen
 */
export function flyTo(lat, lon, zoom = 11) {
    state.map.setView([lat, lon], zoom);
}

/**
 * Höhe von API abrufen
 */
export async function getElevation(lat, lon) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
        const r = await fetch(API_CONFIG.elevationUrl + '?latitude=' + lat + '&longitude=' + lon, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const d = await r.json();
        return d.elevation?.[0] || 0;
    } catch(e) {
        clearTimeout(timeoutId);
        return 0;
    }
}

/**
 * GPS-Position abrufen
 */
export function getGPSLocation() {
    const btn = document.getElementById('gpsBtn');
    btn.disabled = true;
    btn.textContent = '⏳';

    if (!navigator.geolocation) {
        showToast('GPS nicht unterstützt');
        btn.disabled = false;
        btn.textContent = '📍';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            await handleMapClick(pos.coords.latitude, pos.coords.longitude, 'Mein Standort');
            state.map.setView([pos.coords.latitude, pos.coords.longitude], 12);
            btn.disabled = false;
            btn.textContent = '📍';
        },
        (err) => {
            const messages = {
                1: 'GPS-Zugriff verweigert',
                2: 'Position nicht verfügbar',
                3: 'Zeitüberschreitung'
            };
            showToast(messages[err.code] || 'GPS-Fehler');
            btn.disabled = false;
            btn.textContent = '📍';
        }
    );
}


/**
 * URL mit Koordinaten aktualisieren
 */
export function updateURL() {
    if (state.currentLocation.lat && state.currentLocation.lon) {
        const params = new URLSearchParams();
        params.set('lat', state.currentLocation.lat.toFixed(4));
        params.set('lon', state.currentLocation.lon.toFixed(4));
        if (state.currentLocation.name && !state.currentLocation.name.includes('N,')) {
            params.set('name', state.currentLocation.name);
        }
        window.history.replaceState({}, '', window.location.pathname + '?' + params.toString());
    }
}

/**
 * Standort-URL teilen
 */
export function shareLocation() {
    navigator.clipboard.writeText(window.location.href).then(() => {
        showToast('🔗 Link kopiert!', 'success');
    }).catch(() => {
        showToast('Fehler beim Kopieren', 'error');
    });
}

/**
 * Koordinaten validieren (Schutz vor ungültigen URL-Parametern)
 */
export function isValidCoordinate(lat, lon) {
    return !isNaN(lat) && !isNaN(lon) &&
           isFinite(lat) && isFinite(lon) &&
           lat >= -90 && lat <= 90 &&
           lon >= -180 && lon <= 180;
}

/**
 * URL-Parameter prüfen und ggf. Standort laden
 */
export function checkURLParams() {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get('lat'));
    const lon = parseFloat(params.get('lon'));
    const name = params.get('name');
    const theme = params.get('theme');

    // Koordinaten validieren
    if (params.has('lat') && params.has('lon') && !isValidCoordinate(lat, lon)) {
        console.warn('Ungültige Koordinaten in URL:', lat, lon);
        return { lat: NaN, lon: NaN, name: null, theme };
    }

    return { lat, lon, name, theme };
}
