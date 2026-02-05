/**
 * SkyCheck - Konfiguration
 * LIMITS, WEATHER_CODES und andere Konstanten
 * v10 - Sicherheit, PWA-Verbesserungen, 900hPa Integration
 */

// === SkyCheck App Info ===
export const APP_INFO = {
    name: 'SkyCheck',
    version: '10.0.0',  // Hauptversion - Cache-Version (sw.js) kann unabhängig sein
    slogan: 'Sicherer fliegen mit der Wetterampel',
    description: 'Detaillierte Gleitschirm-Wetteranalyse',
    author: 'SkyCheck Team',
    year: 2025,
    // Email verschleiert gegen Spam-Bots (wird in ui.js zusammengesetzt)
    feedbackEmailParts: ['danielbaehring', 'gmail.com']
};

// === API Konfiguration ===
export const API_CONFIG = {
    baseUrl: 'https://api.open-meteo.com/v1/forecast',
    elevationUrl: 'https://api.open-meteo.com/v1/elevation',
    timeout: 15000,  // Max. Wartezeit in ms
    // OpenWindMap/Pioupiou API für Live-Winddaten
    pioupiouUrl: 'https://api.pioupiou.fr/v1/live/all',
    pioupiouStationUrl: 'https://api.pioupiou.fr/v1/live/',
    // Lawinenwarndienste (avalanche.report) - Alpenraum
    // Quellen: LWD Tirol, Bayern, Salzburg, Südtirol, GeoSphere Austria
    avalancheReportUrl: 'https://static.avalanche.report/weather_stations/',
    avalancheReportEnabled: true,  // Kann deaktiviert werden falls API-Probleme
    // Gemeinsame Live-Wind Konfiguration
    liveWindRadius: 30,  // km - Radius für Stationen in der Nähe (erhöht für Bergstationen)
    liveWindMaxStations: 8,  // Max. Anzahl angezeigter Stationen (erhöht)
    liveWindCacheTTL: 60000  // 60 Sekunden Cache
};

// Drucklevel-Konfiguration
export const PRESSURE_LEVELS = {
    ground: {
        hPa: 1000,
        approxAlt: 0,
        label: 'Boden',
        description: 'Windverhältnisse am Startplatz'
    },
    veryLow: {
        hPa: 900,
        approxAlt: 1000,
        label: '~1000m',
        description: 'Typische Flughöhe Hügel/Mittelgebirge'
    },
    low: {
        hPa: 850,
        approxAlt: 1500,
        label: '~1500m',
        description: 'Typische Flughöhe Alpenvorland'
    },
    mid: {
        hPa: 800,
        approxAlt: 2000,
        label: '~2000m',
        description: 'Obere Thermik-Zone'
    },
    high: {
        hPa: 700,
        approxAlt: 3000,
        label: '~3000m',
        description: 'Hochalpine Bedingungen, Wolkenbasis'
    }
};

// Grenzwerte für die Ampel-Bewertung (v9.2 - Alpine Sicherheitsstandards)
// Referenz: DHV/SHV Empfehlungen, 30er-Regel für Höhenwind
export const LIMITS = {
    wind: {
        surface: { green: 12, yellow: 18 },       // Bodenwind (Flugschul-Standard)
        gusts: { green: 15, yellow: 25 },         // Böen
        gustSpread: { green: 8, yellow: 15 },     // Differenz Böen - Grundwind (Turbulenz-Indikator)
        w900: { green: 15, yellow: 25 },          // Wind 1000m (typische Flughöhe Hügel/Mittelgebirge)
        w850: { green: 18, yellow: 28 },          // Wind 1500m (Lee-Gefahr ab 25-30)
        w800: { green: 22, yellow: 30 },          // Wind 2000m (30er-Regel, war 35)
        w700: { green: 25, yellow: 30 },          // Wind 3000m (30er-Regel, war 40 - Trimm liegt bei 36-39!)
        gradient: { green: 10, yellow: 18 },      // Gradient Boden-1500m (Scherungsindikator)
        gradient3000: { green: 15, yellow: 25 },  // Gradient Boden-3000m
        gustFactor: { green: 0.5, yellow: 1.0 },  // Böen/Grundwind Verhältnis (legacy)
        gustFactorMinWind: { green: 15, yellow: 20 }  // Min. Böenstärke für Faktor-Warnung
    },
    spread: { min: 3, optimalMin: 5, optimalMax: 15, max: 20 },
    // Nebel-Erkennung (intelligente Kombination statt nur Spread)
    fog: {
        spreadSevere: 1.0,       // Kritisch wenn Spread < 1°C (fast gesättigt)
        spreadWarning: 3.0,      // Warnung wenn Spread < 3°C
        windThreshold: 5,        // Unter 5 km/h kann sich Bodennebel halten
        windDisperse: 12,        // Ab 12 km/h wird Nebel meist aufgelöst
        visibilitySevere: 1500,  // ROT: VFR-Minimum unterschritten
        visibilityWarning: 5000  // GELB: Eingeschränkte Sicht
    },
    cape: { green: 300, yellow: 1000 },
    liftedIndex: { green: -2, yellow: -4 },  // Negativer = labiler
    clouds: {
        low: { green: 30, yellow: 60 },
        total: { green: 50, yellow: 75 }
    },
    visibility: { green: 10000, yellow: 5000 },
    precip: { green: 0.1, yellow: 1 },
    showers: { green: 0.1, yellow: 0.5 },
    precipProb: { yellow: 30 }  // Nur Gelb-Schwelle
};

// Anfänger-freundliche Grenzwerte (strenger als normale Grün-Limits)
// Für das Beginner-Badge - perfekte Bedingungen für Flugschüler und Genussflieger
export const BEGINNER_LIMITS = {
    groundWind: 10,      // Bodenwind < 10 km/h (stressfreies Aufziehen)
    gustDiff: 5,         // Böendifferenz < 5 km/h (ruhige Luft)
    w900: 12,            // Höhenwind 1000m < 12 km/h (sanfte Bedingungen)
    w850: 15,            // Höhenwind 1500m < 15 km/h (keine Lee-Gefahr)
    w800: 18,            // Höhenwind 2000m < 18 km/h
    w700: 20,            // Höhenwind 3000m < 20 km/h (kein Föhn)
    gradient: 8,         // Gradient < 8 km/h (sanfter Übergang)
    cape: 200,           // CAPE < 200 J/kg (sanfte Thermik)
    visibility: 15000,   // Sicht > 15 km (gute Orientierung)
    spread: 5            // Spread >= 5°C (keine Nebelgefahr)
};

// v8 NEU: Wetter-Codes für Symbole
export const WEATHER_CODES = {
    0: { icon: '☀️', text: 'Klar' },
    1: { icon: '🌤️', text: 'Überwiegend klar' },
    2: { icon: '⛅', text: 'Teilweise bewölkt' },
    3: { icon: '☁️', text: 'Bedeckt' },
    45: { icon: '🌫️', text: 'Nebel' },
    48: { icon: '🌫️', text: 'Reifnebel' },
    51: { icon: '🌦️', text: 'Nieselregen' },
    53: { icon: '🌦️', text: 'Nieselregen' },
    55: { icon: '🌧️', text: 'Starker Niesel' },
    61: { icon: '🌧️', text: 'Leichter Regen' },
    63: { icon: '🌧️', text: 'Regen' },
    65: { icon: '🌧️', text: 'Starker Regen' },
    71: { icon: '❄️', text: 'Leichter Schnee' },
    73: { icon: '❄️', text: 'Schnee' },
    75: { icon: '❄️', text: 'Starker Schnee' },
    80: { icon: '🌦️', text: 'Schauer' },
    81: { icon: '🌧️', text: 'Schauer' },
    82: { icon: '⛈️', text: 'Starke Schauer' },
    95: { icon: '⛈️', text: 'Gewitter' },
    96: { icon: '⛈️', text: 'Gewitter+Hagel' },
    99: { icon: '⛈️', text: 'Starkes Gewitter' }
};

// localStorage Keys (konsolidiert)
export const STORAGE_KEYS = {
    FAVORITES: 'gleitschirm-meteo-favorites',
    FAVORITES_WEATHER_CACHE: 'gleitschirm-meteo-fav-weather-cache',
    THEME: 'gleitschirm-meteo-theme',
    CONTRAST: 'skycheck-contrast',
    WINDROSE: 'gleitschirm-meteo-windrose',
    HEIGHT: 'gleitschirm-meteo-height',
    LAST_WEATHER: 'gleitschirm-meteo-last-weather',
    PARAM_FILTER: 'gleitschirm-meteo-param-filter',
    WIND_DIAGRAM: 'gleitschirm-meteo-wind-diagram',
    EXPERT_MODE: 'skycheck-expert-mode',
    CUSTOM_LIMITS: 'skycheck-custom-limits'
};

// Cache-Konfiguration
export const CACHE_CONFIG = {
    favoriteWeatherTTL: 60 * 60 * 1000  // 1 Stunde in ms
};

// Parameter-Filter Konfiguration
export const PARAM_FILTER_CONFIG = {
    wind: { label: 'Wind', icon: '💨', default: true },
    thermik: { label: 'Thermik', icon: '🌡️', default: true },
    clouds: { label: 'Sicht', icon: '☁️', default: true },
    precip: { label: 'Niederschlag', icon: '🌧️', default: true }
};

// UI-Konstanten
export const UI_CONFIG = {
    mobileBreakpoint: 500,           // px - Ab hier Mobile-Layout
    toastDuration: 3000,             // ms - Toast-Anzeigedauer
    errorResetDelay: 8000,           // ms - Fehleranzeige zurücksetzen
    mapInvalidateDelay: 100,         // ms - Leaflet invalidateSize Verzögerung
    inputFeedbackDuration: 2000      // ms - Input-Validierungsfeedback
};

// Meteorologische Konstanten
export const METEO_CONSTANTS = {
    cloudBaseMultiplier: 125,        // Spread × 125m = Wolkenbasis über Grund
    freezingLevelWarning: 2000,      // m - Warnung wenn Nullgradgrenze < 2000m
    boundaryLayerWarning: 1000       // m - Warnung wenn Grenzschicht < 1000m
};
