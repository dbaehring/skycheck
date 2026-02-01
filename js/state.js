/**
 * SkyCheck - State Management
 * Zentraler App-Zustand, der von allen Modulen importiert wird
 */

export const state = {
    map: null,
    marker: null,
    currentLocation: {},
    hourlyData: null,
    dailyData: null,
    selectedDay: 0,
    selectedHourIndex: null,
    forecastDays: [],
    favorites: [],
    lastUpdate: null,
    favoriteWeatherCache: {},
    activeKillers: [],
    // Parameter-Filter für Ampel-Bewertung (alle standardmäßig aktiv)
    paramFilter: {
        wind: true,
        thermik: true,
        clouds: true,
        precip: true
    },
    // Expertenmodus: Custom Limits
    expertMode: false,
    customLimits: null  // Überschreibt LIMITS wenn gesetzt
};
