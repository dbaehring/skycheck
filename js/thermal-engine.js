/**
 * Phase 2b: eigenständige Thermik-/XC-Nutzbarkeitsbewertung pro Stunde.
 *
 * Die Engine bewertet weder Flugsicherheit noch CAPE/Lifted Index. Ihr Score
 * trennt thermische Aktivität von belastbarem vertikalem Höhenpotenzial.
 * CAPE, Lifted Index und der diagnostische 0–10-km-Updraft werden nicht
 * gewichtet.
 */

import { THERMAL_THRESHOLDS } from './thermal-config.js';
import { deriveThermalMetrics } from './thermal-metrics.js';

const LEVEL_LABELS = Object.freeze({
    weak: 'Schwach',
    usable: 'Brauchbar',
    good: 'Gut',
    excellent: 'Sehr gut',
    unknown: 'Unklar'
});

function thermalDataQuality(hour, metrics) {
    const cloudValues = Object.values(metrics.cloudCover);
    const precipitationValues = Object.values(metrics.precipitation);
    const hasValue = value => value !== null && value !== undefined;
    const families = {
        time: {
            assessable: Number.isInteger(metrics.localHour),
            detail: 'Lokale Stunde aus dem Vorhersagezeitstempel'
        },
        stability: {
            assessable: metrics.stability.segments.length > 0,
            detail: 'Temperaturgradient aus mindestens zwei gültigen Druckflächen oberhalb des Geländes'
        },
        clouds: {
            assessable: hasValue(metrics.cloudCover.totalPct) || cloudValues.filter(hasValue).length >= 2,
            detail: 'Gesamtbewölkung oder mindestens zwei Wolkenschichten'
        },
        radiation: {
            assessable: hasValue(metrics.shortwaveRadiationWm2),
            detail: 'Kurzwellige Globalstrahlung'
        },
        precipitation: {
            assessable: precipitationValues.some(hasValue),
            detail: 'Mindestens eine Niederschlags-, Schauer- oder Wahrscheinlichkeitsangabe'
        }
    };
    const criticalMissing = Object.entries(families)
        .filter(([, family]) => !family.assessable)
        .map(([name]) => `family:${name}`);
    const optionalMissing = [];
    // ICON liefert Boundary Layer Height über diesen Open-Meteo-Pfad derzeit
    // nicht zuverlässig. Das Feld bleibt für spätere Provider optional.
    if (metrics.boundaryLayerDepthAglM === null) optionalMissing.push('boundaryLayer.heightM');
    if (metrics.modelCloudBaseMslM === null) optionalMissing.push('clouds.convectiveBaseMslM');
    if (metrics.directRadiationWm2 === null) optionalMissing.push('radiation.directWm2');
    if (metrics.diffuseRadiationWm2 === null) optionalMissing.push('radiation.diffuseWm2');
    if (metrics.updraftMs === null) optionalMissing.push('convection.updraftMs');

    const stale = Boolean(hour?.dataQuality?.stale);
    const activityConfidence = criticalMissing.length > 0 || stale
        ? 'low'
        : metrics.stability.availableLevelCount < metrics.stability.expectedLevelCount
            ? 'medium'
            : 'high';
    const heightConfidence = metrics.hasReliableHeightLimit ? 'high' : 'low';
    const overallConfidence = activityConfidence === 'low'
        ? 'low'
        : activityConfidence === 'high' && heightConfidence === 'high'
            ? 'high'
            : 'medium';

    return {
        level: criticalMissing.length > 0 ? 'insufficient' : activityConfidence === 'medium' || stale ? 'partial' : 'good',
        confidence: {
            overall: overallConfidence,
            activity: activityConfidence,
            height: heightConfidence
        },
        criticalMissing,
        missing: optionalMissing,
        optionalMissing,
        families,
        stale
    };
}

function scoreDepth(depthM) {
    const config = THERMAL_THRESHOLDS.depth;
    if (depthM < config.usableM) return config.points[0];
    if (depthM < config.fairM) return config.points[1];
    if (depthM < config.goodM) return config.points[2];
    if (depthM < config.excellentM) return config.points[3];
    return config.points[4];
}

function scoreRadiation(metrics) {
    const config = THERMAL_THRESHOLDS.radiation;
    const radiation = metrics.shortwaveRadiationWm2;
    if (radiation < config.minimumWm2) return config.points[0];

    const bands = config.absoluteBandsWm2;
    let points;
    if (radiation < bands[1]) points = config.points[1];
    else if (radiation < bands[2]) points = config.points[2];
    else if (radiation < bands[3]) points = config.points[3];
    else points = config.points[4];

    // Das Tagesmaximum wirkt nur als kleiner Bonus auf bereits starke absolute
    // Einstrahlung; ein abgeschirmtes Maximum von 250 W/m² bleibt schwach.
    if (radiation >= config.dailyPeakBonusMinimumWm2 &&
        metrics.radiationRatioToDayPeak >= config.dailyPeakBonusRatio) {
        points += config.dailyPeakBonusPoints;
    }
    return Math.min(points, config.maximumPoints);
}

function scoreStability(metrics, reasons) {
    const config = THERMAL_THRESHOLDS.stability;
    const { category, averageLapseRateKPerKm, inversion } = metrics.stability;
    let rawPoints;
    if (category === 'inversion') {
        rawPoints = Math.max(
            config.points.inversionMinimum,
            config.points.inversionBase + inversion.temperatureIncreaseK * config.points.inversionPerKelvin
        );
    } else if (category === 'stable') {
        const fraction = Math.max(0, averageLapseRateKPerKm) / config.stableBelowKPerKm;
        rawPoints = config.points.stableMinimum +
            fraction * (config.points.neutralAtStableThreshold - config.points.stableMinimum);
    } else if (category === 'neutral') {
        const fraction = (averageLapseRateKPerKm - config.stableBelowKPerKm) /
            (config.supportiveFromKPerKm - config.stableBelowKPerKm);
        rawPoints = config.points.neutralAtStableThreshold +
            fraction * (config.points.supportiveAtThreshold - config.points.neutralAtStableThreshold);
    } else {
        const fraction = Math.min(1, (averageLapseRateKPerKm - config.supportiveFromKPerKm) /
            (config.dryAdiabaticReferenceKPerKm - config.supportiveFromKPerKm));
        rawPoints = config.points.supportiveAtThreshold +
            fraction * (config.points.supportiveMaximum - config.points.supportiveAtThreshold);
    }
    const points = Math.round(rawPoints);
    const averageText = Number.isFinite(averageLapseRateKPerKm)
        ? `${averageLapseRateKPerKm.toFixed(1)} K/km`
        : 'nicht bestimmbar';
    const descriptions = {
        supportive: `Günstige untere Schichtung (${averageText})`,
        neutral: `Neutrale untere Schichtung (${averageText})`,
        stable: `Stabile untere Schichtung (${averageText})`,
        inversion: inversion
            ? `Inversion zwischen ca. ${Math.round(inversion.lowerHeightMslM / 100) * 100} und ${Math.round(inversion.upperHeightMslM / 100) * 100} m MSL`
            : `Inversionssignal (${averageText})`
    };
    reasons.push({ code: `stability-${category}`, component: 'thermalActivity.stability', impact: points, text: descriptions[category] });
    return points;
}

function scoreCloudPenalty(metrics, reasons) {
    const config = THERMAL_THRESHOLDS.clouds;
    const { totalPct, lowPct, midPct, highPct } = metrics.cloudCover;
    let penalty = 0;

    if (lowPct >= config.low.closedPct) {
        penalty -= 18;
        reasons.push({ code: 'closed-low-clouds', component: 'cloudPenalty', impact: -18, text: `Geschlossene tiefe Bewölkung ${Math.round(lowPct)}%` });
    } else if (lowPct >= config.low.moderatePct) {
        penalty -= 10;
        reasons.push({ code: 'low-cloud-shielding', component: 'cloudPenalty', impact: -10, text: `Viel tiefe Bewölkung ${Math.round(lowPct)}%` });
    }

    if (midPct >= config.mid.strongShieldingPct) {
        penalty -= 12;
        reasons.push({ code: 'mid-cloud-shielding', component: 'cloudPenalty', impact: -12, text: `Starke mittlere Abschirmung ${Math.round(midPct)}%` });
    } else if (midPct >= config.mid.shieldingPct) {
        penalty -= 7;
        reasons.push({ code: 'mid-cloud-shielding', component: 'cloudPenalty', impact: -7, text: `Zunehmende mittlere Bewölkung ${Math.round(midPct)}%` });
    }

    if (highPct >= config.high.strongShieldingPct) {
        penalty -= 8;
        reasons.push({ code: 'high-cloud-shielding', component: 'cloudPenalty', impact: -8, text: `Dichte hohe Abschirmung ${Math.round(highPct)}%` });
    } else if (highPct >= config.high.shieldingPct) {
        penalty -= 4;
        reasons.push({ code: 'high-cloud-shielding', component: 'cloudPenalty', impact: -4, text: `Hohe Bewölkung ${Math.round(highPct)}%` });
    }

    if (totalPct >= config.closedTotalPct && metrics.shortwaveRadiationWm2 < config.lowRadiationWm2) {
        penalty -= 8;
        reasons.push({ code: 'overcast-low-radiation', component: 'cloudPenalty', impact: -8, text: 'Starke Gesamtbewölkung mit geringer Einstrahlung' });
    }
    return Math.max(penalty, config.minimumPenalty);
}

function scorePrecipitationPenalty(metrics, reasons) {
    const config = THERMAL_THRESHOLDS.precipitation;
    const { amountMm, showersMm, probabilityPct } = metrics.precipitation;
    let penalty = 0;
    let text = null;

    if (amountMm > config.strongMm || showersMm > config.showersStrongMm) {
        penalty = -30;
        text = 'Kräftiger Niederschlag oder Schauer begrenzt die Thermiknutzung';
    } else if (showersMm > config.showersRelevantMm) {
        penalty = -22;
        text = `Schauer ${showersMm.toFixed(1)} mm`;
    } else if (amountMm > config.relevantMm) {
        penalty = -18;
        text = `Niederschlag ${amountMm.toFixed(1)} mm`;
    } else if (amountMm > config.traceMm || showersMm > config.traceMm) {
        penalty = -8;
        text = 'Leichte Niederschlagssignale';
    }

    if (probabilityPct > config.probabilityHighPct && penalty > -12) {
        penalty = -12;
        text = `Hohe Niederschlagswahrscheinlichkeit ${Math.round(probabilityPct)}%`;
    } else if (probabilityPct > config.probabilityRelevantPct && penalty > -6) {
        penalty = -6;
        text = `Erhöhte Niederschlagswahrscheinlichkeit ${Math.round(probabilityPct)}%`;
    }
    if (penalty < 0) reasons.push({ code: 'precipitation-usability', component: 'precipitationPenalty', impact: penalty, text });
    return penalty;
}

function scoreWindUsability(metrics, reasons) {
    const config = THERMAL_THRESHOLDS.wind;
    const windValues = [metrics.windAtThermalTopKmh, metrics.boundaryLayerWindKmh].filter(Number.isFinite);
    if (windValues.length === 0) return 0;
    const referenceWind = Math.max(...windValues);
    let points;
    let text;
    if (referenceWind <= config.lightKmh) {
        points = 4;
        text = `Schwacher Wind in der Thermikschicht ${referenceWind.toFixed(1)} km/h`;
    } else if (referenceWind <= config.usefulKmh) {
        points = 10;
        text = `Gut nutzbarer Wind in der Thermikschicht ${referenceWind.toFixed(1)} km/h`;
    } else if (referenceWind <= config.strongKmh) {
        points = 4;
        text = `Sportlicher, noch nutzbarer Höhenwind ${referenceWind.toFixed(1)} km/h`;
    } else if (referenceWind <= config.veryStrongKmh) {
        points = -8;
        text = `Starker Wind erschwert die Thermiknutzung ${referenceWind.toFixed(1)} km/h`;
    } else {
        points = -20;
        text = `Sehr starker Wind reduziert die Thermiknutzung ${referenceWind.toFixed(1)} km/h`;
    }

    if (metrics.maxAdjacentSpeedShearKmh > config.shearStrongKmh) points -= 12;
    else if (metrics.maxAdjacentSpeedShearKmh > config.shearElevatedKmh) points -= 7;
    if (metrics.maxAdjacentDirectionShearDeg > config.directionStrongDeg) points -= 8;
    else if (metrics.maxAdjacentDirectionShearDeg > config.directionElevatedDeg) points -= 4;
    points = Math.max(points, config.minimumPoints);
    reasons.push({ code: 'wind-usability', component: 'windUsability', impact: points, text });
    return points;
}

function levelFromScore(score, components, metrics) {
    const levels = THERMAL_THRESHOLDS.levels;
    // Vertikaler Raum allein erzeugt keine Thermik. Unter 20 Aktivitätspunkten
    // bleibt die Stunde deshalb schwach, selbst wenn eine hohe Basis vorliegt.
    if (components.thermalActivity.score < 20) return 'weak';
    if (score < levels.usablePoints) return 'weak';
    if (score < levels.goodPoints) return 'usable';
    if (score < levels.excellentPoints) return 'good';
    const excellentQualifiers = metrics.hasReliableHeightLimit &&
        metrics.usableThermalDepthM >= levels.excellentMinimumDepthM &&
        components.thermalActivity.score >= levels.excellentMinimumActivityPoints &&
        components.thermalActivity.precipitationPenalty === 0;
    return excellentQualifiers ? 'excellent' : 'good';
}

export function assessThermal(hour, options = {}) {
    const metrics = deriveThermalMetrics(hour, options.context || {});
    const dataQuality = thermalDataQuality(hour, metrics);
    if (dataQuality.criticalMissing.length > 0) {
        return {
            level: 'unknown',
            label: LEVEL_LABELS.unknown,
            score: null,
            reasons: [{
                code: 'critical-missing-data',
                component: 'dataQuality',
                impact: null,
                text: `Keine belastbare Thermikbewertung: ${dataQuality.criticalMissing.join(', ')}`
            }],
            limitingFactor: { code: 'critical-missing-data', text: 'Zentrale Thermikdaten fehlen' },
            components: null,
            metrics,
            confidence: dataQuality.confidence,
            dataQuality
        };
    }

    const reasons = [];
    const depth = metrics.usableThermalDepthM !== null ? scoreDepth(metrics.usableThermalDepthM) : 0;
    const radiation = scoreRadiation(metrics);
    if (metrics.hasReliableHeightLimit) {
        reasons.push({
            code: 'thermal-depth',
            component: 'verticalPotential.depth',
            impact: depth,
            text: `Belastbare nutzbare Thermiktiefe ca. ${Math.round(metrics.usableThermalDepthM / 100) * 100} m über Standort (${metrics.upperLimitSources.join(' + ')})`
        });
    } else {
        reasons.push({
            code: 'height-potential-uncertain',
            component: 'verticalPotential',
            impact: 0,
            text: 'Höhenpotenzial mangels modellbasierter Thermikobergrenze unsicher'
        });
    }
    if (metrics.cloudBaseSource === 'estimatedLcl') {
        reasons.push({
            code: 'estimated-lcl-information',
            component: 'verticalPotential',
            impact: 0,
            text: `Geschätztes LCL ca. ${Math.round(metrics.estimatedLclMslM / 100) * 100} m MSL – nicht als Thermikobergrenze gewertet`
        });
    }
    reasons.push({
        code: 'solar-radiation',
        component: 'thermalActivity.radiation',
        impact: radiation,
        text: `Kurzwellige Einstrahlung ${Math.round(metrics.shortwaveRadiationWm2)} W/m²${metrics.radiationRatioToDayPeak !== null ? ` (${Math.round(metrics.radiationRatioToDayPeak * 100)}% des Tagesmaximums)` : ''}`
    });
    const stability = scoreStability(metrics, reasons);
    const cloudPenalty = scoreCloudPenalty(metrics, reasons);
    const precipitationPenalty = scorePrecipitationPenalty(metrics, reasons);
    const windUsability = scoreWindUsability(metrics, reasons);
    if (metrics.updraftMs !== null) {
        reasons.push({
            code: 'updraft-information',
            component: 'updraftSignal',
            impact: 0,
            text: `Modell-Updraft ${metrics.updraftMs.toFixed(1)} m/s – wegen 0–10-km-Maximum nicht gewichtet`
        });
    }

    const activityScore = Math.max(0, Math.min(60, radiation + stability + cloudPenalty + precipitationPenalty));
    const components = {
        thermalActivity: {
            radiation,
            stability,
            cloudPenalty,
            precipitationPenalty,
            score: activityScore
        },
        verticalPotential: {
            depth,
            reliable: metrics.hasReliableHeightLimit,
            sources: metrics.upperLimitSources
        },
        windUsability,
        updraftSignal: 0
    };
    const score = Math.max(0, Math.min(100, activityScore + depth + windUsability));
    const level = levelFromScore(score, components, metrics);
    const negativeReasons = reasons.filter(reason => reason.impact < 0).sort((a, b) => a.impact - b.impact);
    const limitingReason = negativeReasons[0] ||
        [...reasons].filter(reason => reason.impact !== null).sort((a, b) => a.impact - b.impact)[0] ||
        null;

    return {
        level,
        label: LEVEL_LABELS[level],
        score,
        reasons,
        limitingFactor: limitingReason ? { code: limitingReason.code, text: limitingReason.text } : null,
        components,
        metrics,
        confidence: dataQuality.confidence,
        dataQuality
    };
}
