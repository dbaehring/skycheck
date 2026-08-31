/** Reine Definition und Umwandlung der bestehenden v10-Expertenprofile. */

import { LIMITS } from './config.js';

export const EXPERT_PRESETS = Object.freeze({
    beginner: {
        label: 'Anfänger',
        description: 'Konservative Limits für Flugschüler und Genussflieger',
        values: { windSurface: 12, windGusts: 18, gustSpread: 10, gradient: 12, w900: 18, w850: 20, w700: 22, cape: 500, cloudLow: 40, visibility: 15000, precip: 0.5, precipProb: 20 }
    },
    standard: {
        label: 'Standard',
        description: 'Ausgewogene Limits für erfahrene Freizeitpiloten',
        values: { windSurface: LIMITS.wind.surface.yellow, windGusts: LIMITS.wind.gusts.yellow, gustSpread: LIMITS.wind.gustSpread.yellow, gradient: LIMITS.wind.gradient.yellow, w900: LIMITS.wind.w900.yellow, w850: LIMITS.wind.w850.yellow, w700: LIMITS.wind.w700.yellow, cape: LIMITS.cape.yellow, cloudLow: LIMITS.clouds.low.yellow, visibility: LIMITS.visibility.green, precip: LIMITS.precip.yellow, precipProb: LIMITS.precipProb.yellow }
    },
    pro: {
        label: 'Profi',
        description: 'Erweiterte Limits für erfahrene Piloten mit guter Ortskenntnis',
        values: { windSurface: 22, windGusts: 32, gustSpread: 18, gradient: 22, w900: 30, w850: 35, w700: 40, cape: 1500, cloudLow: 70, visibility: 8000, precip: 2, precipProb: 40 }
    }
});

export function calculateGreenThreshold(yellow, defaultGreen, defaultYellow) {
    return Math.round(yellow * (defaultGreen / defaultYellow));
}

export function buildCustomLimits(values) {
    return {
        wind: {
            surface: { yellow: values.windSurface, green: calculateGreenThreshold(values.windSurface, LIMITS.wind.surface.green, LIMITS.wind.surface.yellow) },
            gusts: { yellow: values.windGusts, green: calculateGreenThreshold(values.windGusts, LIMITS.wind.gusts.green, LIMITS.wind.gusts.yellow) },
            gustSpread: { yellow: values.gustSpread, green: calculateGreenThreshold(values.gustSpread, LIMITS.wind.gustSpread.green, LIMITS.wind.gustSpread.yellow) },
            gradient: { yellow: values.gradient, green: calculateGreenThreshold(values.gradient, LIMITS.wind.gradient.green, LIMITS.wind.gradient.yellow) },
            w900: { yellow: values.w900, green: calculateGreenThreshold(values.w900, LIMITS.wind.w900.green, LIMITS.wind.w900.yellow) },
            w850: { yellow: values.w850, green: calculateGreenThreshold(values.w850, LIMITS.wind.w850.green, LIMITS.wind.w850.yellow) },
            w700: { yellow: values.w700, green: calculateGreenThreshold(values.w700, LIMITS.wind.w700.green, LIMITS.wind.w700.yellow) }
        },
        cape: { yellow: values.cape, green: calculateGreenThreshold(values.cape, LIMITS.cape.green, LIMITS.cape.yellow) },
        clouds: {
            low: { yellow: values.cloudLow, green: calculateGreenThreshold(values.cloudLow, LIMITS.clouds.low.green, LIMITS.clouds.low.yellow) }
        },
        visibility: { green: values.visibility, yellow: Math.round(values.visibility * 0.5) },
        precip: { yellow: values.precip, green: Math.round(values.precip * 0.1 * 10) / 10 },
        precipProb: { yellow: values.precipProb }
    };
}

