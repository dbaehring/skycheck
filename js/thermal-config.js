/**
 * Phase 2b: nachvollziehbare, vorläufige Thermik-/XC-Kalibrierung.
 *
 * Die Punkte beschreiben Nutzbarkeit, nicht Sicherheit. CAPE und Lifted Index
 * kommen hier absichtlich nicht vor. Alle Schwellen sind fachlich vorläufig
 * und zentral gebündelt, damit sie später mit Flugtagen kalibriert werden
 * können.
 */

export const THERMAL_LEVEL_RANK = Object.freeze({
    unknown: -1,
    weak: 0,
    usable: 1,
    good: 2,
    excellent: 3
});

export const THERMAL_THRESHOLDS = Object.freeze({
    depth: Object.freeze({
        usableM: 500,
        fairM: 1000,
        goodM: 1500,
        excellentM: 2200,
        points: Object.freeze([0, 6, 12, 18, 25])
    }),
    radiation: Object.freeze({
        // Absolute Stundenmittel der kurzwelligen Globalstrahlung sind der
        // Primärfaktor. Die Marken sind vorläufig und bewusst breit gestuft.
        minimumWm2: 100,
        absoluteBandsWm2: Object.freeze([100, 250, 450, 650]),
        points: Object.freeze([0, 10, 22, 35, 45]),
        dailyPeakBonusMinimumWm2: 450,
        dailyPeakBonusRatio: 0.8,
        dailyPeakBonusPoints: 3,
        maximumPoints: 45
    }),
    stability: Object.freeze({
        // NWS: <5,5–6 K/km stabil, ~9,5 K/km instabil. Quellen:
        // weather.gov/btv/profileLapseRate und weather.gov/glossary.php?word=Lapse+rate
        // Die 7-K/km-Unterstützungsschwelle ist ein konservativer,
        // vorläufiger Übergang; die Punkte werden zwischen den Marken
        // linear vergeben, nicht als meteorologischer Hard Cutoff.
        stableBelowKPerKm: 5.5,
        supportiveFromKPerKm: 7,
        dryAdiabaticReferenceKPerKm: 9.8,
        inversionBelowKPerKm: 0,
        minimumLayerDepthM: 100,
        minimumAboveTerrainM: 50,
        points: Object.freeze({
            inversionBase: -8,
            inversionPerKelvin: -8,
            inversionMinimum: -25,
            stableMinimum: -10,
            neutralAtStableThreshold: 0,
            supportiveAtThreshold: 10,
            supportiveMaximum: 15
        })
    }),
    clouds: Object.freeze({
        low: Object.freeze({ moderatePct: 60, closedPct: 80 }),
        mid: Object.freeze({ shieldingPct: 60, strongShieldingPct: 80 }),
        high: Object.freeze({ shieldingPct: 70, strongShieldingPct: 90 }),
        closedTotalPct: 85,
        lowRadiationWm2: 250,
        minimumPenalty: -30
    }),
    precipitation: Object.freeze({
        traceMm: 0,
        relevantMm: 0.1,
        strongMm: 1,
        showersRelevantMm: 0.1,
        showersStrongMm: 0.5,
        probabilityRelevantPct: 30,
        probabilityHighPct: 60
    }),
    wind: Object.freeze({
        lightKmh: 5,
        usefulKmh: 22,
        strongKmh: 30,
        veryStrongKmh: 40,
        shearElevatedKmh: 18,
        shearStrongKmh: 22,
        directionElevatedDeg: 60,
        directionStrongDeg: 90,
        minimumPoints: -20
    }),
    levels: Object.freeze({
        usablePoints: 30,
        goodPoints: 50,
        excellentPoints: 75,
        excellentMinimumDepthM: 2200,
        excellentMinimumActivityPoints: 45
    }),
    aggregation: Object.freeze({
        minimumKnownHours: 3,
        goodWindowHours: 3,
        excellentWindowHours: 4,
        excellentHours: 2,
        excellentAverageDepthM: 2000
    })
});
