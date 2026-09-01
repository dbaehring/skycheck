/**
 * Phase 3: vorläufige, transparente Föhnkalibrierung.
 *
 * Der Bozen–Innsbruck-Gradient ist definiert als Druck in Bozen minus Druck
 * in Innsbruck, jeweils auf Meereshöhe reduziert. Positive Werte unterstützen
 * Südföhn an der Alpennordseite, negative Werte Nordföhn in Südtirol.
 * Die offiziellen Erfahrungsmarken 3/6 hPa sind keine Alleinentscheidung:
 * https://wetter.provinz.bz.it/de/foehndiagramm
 */

export const FOEHN_REGION = Object.freeze({
    alps: Object.freeze({ minLat: 45.0, maxLat: 48.8, minLon: 5.5, maxLon: 16.8 }),
    bozenInnsbruckIndicator: Object.freeze({ minLat: 45.2, maxLat: 48.2, minLon: 8.5, maxLon: 14.5 })
});

// Grobe Linie des Alpenhauptkamms für eine lokale Luv-/Lee-Einordnung.
// Die Toleranz hält Standorte nahe am Kamm bewusst neutral.
export const FOEHN_SITE_CONTEXT = Object.freeze({
    divideToleranceLat: 0.18,
    alpineDivide: Object.freeze([
        Object.freeze({ lon: 5.5, lat: 45.9 }),
        Object.freeze({ lon: 7.0, lat: 46.2 }),
        Object.freeze({ lon: 8.0, lat: 46.5 }),
        Object.freeze({ lon: 9.0, lat: 46.7 }),
        Object.freeze({ lon: 10.0, lat: 46.85 }),
        Object.freeze({ lon: 11.4, lat: 46.95 }),
        Object.freeze({ lon: 12.5, lat: 47.05 }),
        Object.freeze({ lon: 14.5, lat: 47.1 }),
        Object.freeze({ lon: 16.8, lat: 47.0 })
    ])
});

export const FOEHN_REFERENCE_POINTS = Object.freeze({
    bozen: Object.freeze({ name: 'Bozen', lat: 46.4983, lon: 11.3548 }),
    innsbruck: Object.freeze({ name: 'Innsbruck', lat: 47.2692, lon: 11.4041 })
});

export const FOEHN_LINKS = Object.freeze({
    officialDiagram: 'https://wetter.provinz.bz.it/de/foehndiagramm',
    civisStations: 'https://data.civis.bz.it/de/dataset/p-bz-southtyrolean-weatherservice-weatherstations'
});

export const FOEHN_THRESHOLDS = Object.freeze({
    pressure: Object.freeze({
        signalHpa: 1.5,
        supportedHpa: 3,
        strongHpa: 6,
        points: Object.freeze([0, 6, 14, 22])
    }),
    flow: Object.freeze({
        levels: Object.freeze([850, 800, 700]),
        minimumCrossAlpineKmh: 12,
        southSector: Object.freeze({ fromDeg: 135, toDeg: 240 }),
        northSector: Object.freeze({ fromDeg: 300, toDeg: 45 }),
        matchingLevelPoints: Object.freeze([0, 5, 12, 18]),
        strongConsistencySpreadDeg: 45,
        consistencyPoints: Object.freeze({ moderate: 4, strong: 8 })
    }),
    strength: Object.freeze({
        elevatedKmh: 20,
        strongKmh: 30,
        criticalKmh: 40,
        points: Object.freeze([2, 6, 10, 14])
    }),
    trend: Object.freeze({
        pressureChangeHpa: 0.8,
        windChangeKmh: 5,
        points: Object.freeze({ increasing: 8, steady: 4, decreasing: -4, unknown: 0 })
    }),
    levels: Object.freeze({
        elevatedPoints: 15,
        highPoints: 45,
        criticalPoints: 60
    })
});
