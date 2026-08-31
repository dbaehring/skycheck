/**
 * Phase 2a: strikt getrennte Komfort- und Hard-Safety-Konfiguration.
 *
 * Hard Blocker sind nicht übersteuerbare Hinweise auf kritische
 * Wetterindikatoren. Sie sind weder allgemeine Flugverbote noch eine
 * Flugfreigabe. Komfortgrenzen bleiben über die Expertenprofile anpassbar.
 *
 * Die festen Windwerte sind vorläufig. Sie stammen aus vorhandenen v10- und
 * Profi-Grenzen und müssen später mit einer fachlichen Referenz kalibriert
 * werden. Die Engine erzeugt daraus keine zusätzliche Scheingenauigkeit.
 */

import { LIMITS } from './config.js';

export const SAFETY_LEVEL_RANK = Object.freeze({
    relaxed: 0,
    sporty: 1,
    demanding: 2,
    critical: 3,
    unknown: -1
});

export const DIRECTION_SHEAR_COMFORT = Object.freeze({
    green: 30,
    yellow: 60
});

export const HARD_SAFETY_THRESHOLDS = Object.freeze({
    wind: Object.freeze({
        surfaceKmh: 22,
        gustsKmh: 32,
        gustSpreadKmh: 18,
        gustFactor: LIMITS.wind.gustFactor.yellow,
        gustFactorMinWindKmh: LIMITS.wind.gustFactorMinWind.yellow,
        aloftExtremeKmh: 40,
        adjacentSpeedShearKmh: 22,
        adjacentSpeedShearMinAloftKmh: LIMITS.wind.w850.yellow,
        directionCombinationDeg: 60,
        directionCombinationMinAloftKmh: LIMITS.wind.w850.yellow
    }),
    visibility: Object.freeze({
        severeM: LIMITS.fog.visibilitySevere
    }),
    fog: Object.freeze({
        spreadSevereC: LIMITS.fog.spreadSevere,
        windThresholdKmh: LIMITS.fog.windThreshold
    }),
    precipitation: Object.freeze({
        amountMm: 2,
        showersMm: LIMITS.showers.yellow
    }),
    convection: Object.freeze({
        capeJkg: LIMITS.cape.yellow,
        liftedIndex: LIMITS.liftedIndex.yellow,
        showerSignalMm: LIMITS.showers.green,
        thunderstormWeatherCodes: Object.freeze([95, 96, 99]),
        showerWeatherCodes: Object.freeze([80, 81, 82])
    })
});

export const HARD_SAFETY_POLICY = Object.freeze([
    'Feste, vorläufige Extremgrenzen für Bodenwind, Böigkeit und Höhenwind',
    'Starke benachbarte Geschwindigkeitsscherung nur zusammen mit starkem Höhenwind',
    'Extreme Richtungsscherung nur zusammen mit starkem Höhenwind',
    'Bestehende Grenze für sehr schlechte Sicht bzw. schweres Nebelrisiko',
    'Feste Grenzen für eindeutigen Niederschlag und Schauer',
    'Expliziter Gewittercode oder starke Instabilität zusammen mit deutlichem Schauersignal',
    'Kritisches separates Föhnassessment unabhängig vom Komfortprofil'
]);

export function buildComfortThresholds(effectiveLimits = LIMITS) {
    const wind = effectiveLimits.wind || LIMITS.wind;
    return {
        wind: {
            surface: wind.surface || LIMITS.wind.surface,
            gusts: wind.gusts || LIMITS.wind.gusts,
            gustSpread: wind.gustSpread || LIMITS.wind.gustSpread,
            gustFactor: wind.gustFactor || LIMITS.wind.gustFactor,
            gustFactorMinWind: wind.gustFactorMinWind || LIMITS.wind.gustFactorMinWind,
            w900: wind.w900 || LIMITS.wind.w900,
            w850: wind.w850 || LIMITS.wind.w850,
            w800: wind.w800 || LIMITS.wind.w800,
            w700: wind.w700 || LIMITS.wind.w700,
            adjacentSpeedShear: wind.gradient || LIMITS.wind.gradient,
            surfaceTo3000: wind.gradient3000 || LIMITS.wind.gradient3000,
            directionShear: wind.directionShear || DIRECTION_SHEAR_COMFORT
        },
        visibility: effectiveLimits.visibility || LIMITS.visibility,
        fog: effectiveLimits.fog || LIMITS.fog,
        clouds: {
            low: effectiveLimits.clouds?.low || LIMITS.clouds.low
        },
        precipitation: effectiveLimits.precip || LIMITS.precip,
        showers: effectiveLimits.showers || LIMITS.showers,
        precipitationProbability: effectiveLimits.precipProb || LIMITS.precipProb
    };
}
