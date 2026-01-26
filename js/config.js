/**
 * SkyCheck - Konfiguration
 * LIMITS, WEATHER_CODES und andere Konstanten
 * v9 - Rebranding + Bugfixes
 */

// === SkyCheck App Info ===
export const APP_INFO = {
    name: 'SkyCheck',
    version: '9.0.0',
    slogan: 'Sicherer fliegen mit der Wetterampel',
    description: 'Professionelle Gleitschirm-Wetteranalyse',
    author: 'SkyCheck Team',
    year: 2025
};

// Drucklevel-Konfiguration (750hPa entfernt - nicht zuverlässig)
export const PRESSURE_LEVELS = {
    ground: {
        hPa: 1000,
        approxAlt: 0,
        label: 'Boden',
        description: 'Windverhältnisse am Startplatz'
    },
    low: {
        hPa: 850,
        approxAlt: 1500,
        label: '~1500m',
        description: 'Typische Flughöhe, relevanteste Ebene für Gleitschirm'
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
        w850: { green: 18, yellow: 28 },          // Wind 1500m (Lee-Gefahr ab 25-30)
        w800: { green: 22, yellow: 30 },          // Wind 2000m (30er-Regel, war 35)
        w700: { green: 25, yellow: 30 },          // Wind 3000m (30er-Regel, war 40 - Trimm liegt bei 36-39!)
        gradient: { green: 10, yellow: 18 },      // Gradient Boden-1500m (Scherungsindikator)
        gradient3000: { green: 15, yellow: 25 },  // Gradient Boden-3000m
        gustFactor: { green: 0.5, yellow: 1.0 },  // Böen/Grundwind Verhältnis (legacy)
        gustFactorMinWind: { green: 15, yellow: 20 }  // Min. Böenstärke für Faktor-Warnung
    },
    spread: { min: 3, optimalMin: 5, optimalMax: 15, max: 20 },
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

// localStorage Keys
export const STORAGE_KEYS = {
    FAVORITES: 'gleitschirm-meteo-favorites',
    THEME: 'gleitschirm-meteo-theme',
    WINDROSE: 'gleitschirm-meteo-windrose',
    HEIGHT: 'gleitschirm-meteo-height',
    LAST_WEATHER: 'gleitschirm-meteo-last-weather'
};
