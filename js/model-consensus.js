/**
 * Transparente, robuste Multi-Model-Consensus-Bewertung.
 * Dieser Pfad liest keine Safety-, Thermal- oder Foehn-Scores und veraendert
 * sie nicht. Bestehende Thermal-Ergebnisse duerfen nur das Tagesgewicht des
 * relevanten Flugfensters erhoehen.
 */

import {
    CONSENSUS_PRESSURE_LEVELS,
    FORECAST_CONFIDENCE_THRESHOLDS as THRESHOLDS
} from './forecast-confidence-config.js';

const LEVEL_RANK = Object.freeze({ unknown: 0, low: 1, medium: 2, high: 3 });
const THERMAL_LEVEL_RANK = Object.freeze({ unknown: 0, poor: 1, usable: 2, good: 3, excellent: 4 });

function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function numericStats(entries) {
    if (entries.length === 0) return null;
    const values = entries.map(entry => entry.value);
    const center = median(values);
    const deviations = entries.map(entry => ({
        modelId: entry.modelId,
        value: entry.value,
        deviation: Math.abs(entry.value - center)
    }));
    return {
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        range: Math.max(...values) - Math.min(...values),
        median: center,
        mad: median(deviations.map(entry => entry.deviation)),
        values: deviations
    };
}

export function circularDifference(a, b) {
    if (!finite(a) || !finite(b)) return null;
    const normalized = Math.abs(((a - b + 540) % 360) - 180);
    return normalized;
}

function circularMean(entries) {
    if (entries.length === 0) return null;
    const vector = entries.reduce((sum, entry) => {
        const radians = entry.value * Math.PI / 180;
        sum.x += Math.cos(radians);
        sum.y += Math.sin(radians);
        return sum;
    }, { x: 0, y: 0 });
    if (Math.hypot(vector.x, vector.y) < 1e-9) return null;
    return (Math.atan2(vector.y, vector.x) * 180 / Math.PI + 360) % 360;
}

function circularStats(entries) {
    if (entries.length === 0) return null;
    let spread = 0;
    for (let left = 0; left < entries.length; left++) {
        for (let right = left + 1; right < entries.length; right++) {
            spread = Math.max(spread, circularDifference(entries[left].value, entries[right].value));
        }
    }
    const center = circularMean(entries);
    return {
        count: entries.length,
        meanDeg: center,
        spreadDeg: spread,
        values: entries.map(entry => ({
            modelId: entry.modelId,
            value: entry.value,
            deviationDeg: center === null ? null : circularDifference(entry.value, center)
        }))
    };
}

function classifyStats(stats, rangeThresholds, madThresholds) {
    if (!stats || stats.count < THRESHOLDS.minimumModels) return 'unknown';
    if (stats.range <= rangeThresholds.high && stats.mad <= madThresholds.high) return 'high';
    if (stats.range <= rangeThresholds.medium && stats.mad <= madThresholds.medium) return 'medium';
    return 'low';
}

function classifyCircular(stats) {
    if (!stats || stats.count < THRESHOLDS.minimumModels) return 'unknown';
    if (stats.spreadDeg <= THRESHOLDS.wind.directionSpreadDeg.high) return 'high';
    if (stats.spreadDeg <= THRESHOLDS.wind.directionSpreadDeg.medium) return 'medium';
    return 'low';
}

function worseLevel(...levels) {
    const known = levels.filter(level => level && level !== 'unknown');
    if (known.length === 0) return 'unknown';
    return known.reduce((worst, level) => LEVEL_RANK[level] < LEVEL_RANK[worst] ? level : worst, known[0]);
}

function levelFromAverage(average) {
    if (!finite(average)) return 'unknown';
    if (average >= 2.5) return 'high';
    if (average >= 1.75) return 'medium';
    return 'low';
}

function capLevel(level, maximum) {
    if (level === 'unknown') return level;
    return LEVEL_RANK[level] > LEVEL_RANK[maximum] ? maximum : level;
}

function entry(modelHour, value) {
    return finite(value) ? { modelId: modelHour.model.id, value } : null;
}

function evaluateWindLayer(modelHours, pressureHpa = null) {
    const valueFor = modelHour => pressureHpa === null
        ? {
            speed: modelHour.hour.surface.windSpeedKmh,
            direction: modelHour.hour.surface.windDirectionDeg,
            height: null,
            source: 'model'
        }
        : (() => {
            const level = modelHour.hour.wind.levels.find(item => item.pressureHpa === pressureHpa);
            return {
                speed: level?.speedKmh ?? null,
                direction: level?.directionDeg ?? null,
                height: level?.geopotentialHeightMslM ?? null,
                source: level?.source ?? 'unavailable'
            };
        })();
    const values = modelHours.map(modelHour => ({ modelHour, ...valueFor(modelHour) }));
    const speeds = values.map(item => entry(item.modelHour, item.speed)).filter(Boolean);
    const speedStats = numericStats(speeds);
    const speedLevel = classifyStats(
        speedStats,
        THRESHOLDS.wind.speedRangeKmh,
        THRESHOLDS.wind.speedMadKmh
    );
    const allComparableWindsCalm = speeds.length >= THRESHOLDS.minimumModels &&
        speeds.every(item => item.value < THRESHOLDS.calmDirectionSpeedKmh);
    const directions = values
        .filter(item => finite(item.direction) && finite(item.speed) && item.speed >= THRESHOLDS.calmDirectionSpeedKmh)
        .map(item => entry(item.modelHour, item.direction));
    const directionStats = circularStats(directions);
    const directionLevel = allComparableWindsCalm ? 'high' : classifyCircular(directionStats);
    let level = worseLevel(speedLevel, directionLevel);
    if (speedLevel !== 'unknown' && directionLevel === 'unknown') level = capLevel(speedLevel, 'medium');

    return {
        pressureHpa,
        level,
        modelCount: speedStats?.count || 0,
        speed: speedStats,
        direction: directionStats,
        directionIgnoredBecauseCalm: allComparableWindsCalm,
        geopotentialHeight: numericStats(values.map(item => entry(item.modelHour, item.height)).filter(Boolean)),
        interpolatedModels: values
            .filter(item => item.source === 'interpolated' && finite(item.speed))
            .map(item => item.modelHour.model.id)
    };
}

function evaluateWind(modelHours) {
    const surface = evaluateWindLayer(modelHours, null);
    const levels = CONSENSUS_PRESSURE_LEVELS.map(level => evaluateWindLayer(modelHours, level));
    const knownPressure = levels.filter(level => level.level !== 'unknown');
    if (knownPressure.length === 0) {
        return { level: 'unknown', surface, levels, reason: 'Zentrale Höhenwinddaten sind nicht zwischen Modellen vergleichbar.' };
    }

    const weighted = knownPressure.map(level => ({ level: level.level, weight: 2 }));
    if (surface.level !== 'unknown') weighted.push({ level: surface.level, weight: 1 });
    const average = weighted.reduce((sum, item) => sum + LEVEL_RANK[item.level] * item.weight, 0) /
        weighted.reduce((sum, item) => sum + item.weight, 0);
    const lowPressureCount = knownPressure.filter(level => level.level === 'low').length;
    let level = levelFromAverage(average);
    if (lowPressureCount >= 2 || average < 1.75) level = 'low';
    else if (lowPressureCount === 1) level = capLevel(level, 'medium');
    if (knownPressure.length === 1) level = capLevel(level, 'medium');

    const weakest = [...knownPressure].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])[0];
    const label = `${weakest.pressureHpa} hPa`;
    let reason;
    if (level === 'high') {
        const maxRange = Math.max(...knownPressure.map(item => item.speed?.range || 0));
        const maxDirection = Math.max(...knownPressure.map(item => item.direction?.spreadDeg || 0));
        reason = `Höhenwind liegt innerhalb ${Math.round(maxRange)} km/h und ${Math.round(maxDirection)}°.`;
    } else if ((weakest.direction?.spreadDeg || 0) > THRESHOLDS.wind.directionSpreadDeg.medium) {
        reason = `Windrichtung auf ${label} streut um bis zu ${Math.round(weakest.direction.spreadDeg)}°.`;
    } else {
        reason = `Höhenwind auf ${label} reicht von ${Math.round(weakest.speed?.min || 0)} bis ${Math.round(weakest.speed?.max || 0)} km/h.`;
    }
    return { level, surface, levels, averageRank: average, reason };
}

function statsFor(modelHours, getter) {
    return numericStats(modelHours.map(modelHour => entry(modelHour, getter(modelHour.hour))).filter(Boolean));
}

function evaluateThermal(modelHours) {
    const height = statsFor(modelHours, hour => hour.clouds.convectiveBaseMslM);
    const heightLevel = classifyStats(
        height,
        THRESHOLDS.thermalHeight.rangeM,
        THRESHOLDS.thermalHeight.madM
    );
    const radiation = statsFor(modelHours, hour => hour.radiation.shortwaveWm2);
    const radiationLevel = classifyStats(
        radiation,
        THRESHOLDS.radiation.rangeWm2,
        THRESHOLDS.radiation.madWm2
    );
    const stability = numericStats(modelHours.map(modelHour => {
        const level850 = modelHour.hour.wind.levels.find(level => level.pressureHpa === 850);
        const level700 = modelHour.hour.wind.levels.find(level => level.pressureHpa === 700);
        return finite(level850?.temperatureC) && finite(level700?.temperatureC)
            ? { modelId: modelHour.model.id, value: level850.temperatureC - level700.temperatureC }
            : null;
    }).filter(Boolean));
    const stabilityLevel = classifyStats(
        stability,
        THRESHOLDS.stability.rangeC,
        THRESHOLDS.stability.madC
    );
    const known = [heightLevel, radiationLevel, stabilityLevel].filter(level => level !== 'unknown');
    let level = known.length === 0
        ? 'unknown'
        : levelFromAverage(known.reduce((sum, item) => sum + LEVEL_RANK[item], 0) / known.length);
    if (heightLevel === 'low') level = capLevel(level, 'medium');
    if (heightLevel === 'unknown' && level === 'high') level = 'medium';

    let reason;
    if (heightLevel === 'low') reason = `Konvektive Wolkenbasen unterscheiden sich um ${Math.round(height.range)} m.`;
    else if (heightLevel === 'unknown') reason = 'Thermikhöhe ist in weniger als zwei Modellen verfügbar.';
    else if (level === 'high') reason = `Thermikhöhe unterscheidet sich nur um ${Math.round(height.range)} m.`;
    else reason = `Thermikparameter zeigen ${level === 'medium' ? 'mäßige' : 'geringe'} Übereinstimmung.`;

    return {
        level,
        heightLevel,
        radiationLevel,
        stabilityLevel,
        metrics: { height, radiation, stability },
        reason
    };
}

function evaluateClouds(modelHours) {
    const fields = {
        total: hour => hour.clouds.totalPct,
        low: hour => hour.clouds.lowPct,
        mid: hour => hour.clouds.midPct,
        high: hour => hour.clouds.highPct
    };
    const metrics = {};
    const levels = [];
    for (const [key, getter] of Object.entries(fields)) {
        const stats = statsFor(modelHours, getter);
        metrics[key] = stats;
        const level = classifyStats(stats, THRESHOLDS.clouds.rangePct, THRESHOLDS.clouds.madPct);
        if (level !== 'unknown') levels.push({ key, level });
    }
    if (levels.length === 0) return { level: 'unknown', metrics, reason: 'Wolkenfelder sind nicht vergleichbar.' };
    let level = levelFromAverage(levels.reduce((sum, item) => sum + LEVEL_RANK[item.level], 0) / levels.length);
    if (levels.some(item => item.level === 'low')) level = capLevel(level, 'medium');
    const widest = Object.entries(metrics)
        .filter(([, stats]) => stats)
        .sort((a, b) => b[1].range - a[1].range)[0];
    const reason = level === 'high'
        ? 'Wolkenfelder stimmen weitgehend überein.'
        : `Wolkenbedeckung unterscheidet sich um bis zu ${Math.round(widest?.[1].range || 0)} Prozentpunkte.`;
    return { level, metrics, reason };
}

function evaluatePrecipitation(modelHours) {
    const entries = modelHours.map(modelHour => {
        const amount = modelHour.hour.precipitation.amountMm;
        const showers = modelHour.hour.precipitation.showersMm;
        const values = [amount, showers].filter(finite);
        return values.length > 0 ? { modelId: modelHour.model.id, value: Math.max(...values) } : null;
    }).filter(Boolean);
    if (entries.length < THRESHOLDS.minimumModels) {
        return { level: 'unknown', metrics: { count: entries.length }, reason: 'Niederschlag ist nicht vergleichbar.' };
    }
    const stats = numericStats(entries);
    const wet = entries.filter(item => item.value > THRESHOLDS.precipitation.wetThresholdMm);
    const dryCount = entries.length - wet.length;
    let level;
    if (wet.length > 0 && dryCount > 0) {
        level = entries.length === 2 || Math.abs(wet.length - dryCount) <= 1 ? 'low' : 'medium';
    } else if (stats.range <= THRESHOLDS.precipitation.amountRangeMm.high) {
        level = 'high';
    } else if (stats.range <= THRESHOLDS.precipitation.amountRangeMm.medium) {
        level = 'medium';
    } else {
        level = 'low';
    }
    const reason = wet.length > 0 && dryCount > 0
        ? `${dryCount} Modelle trocken, ${wet.length} mit Niederschlag oder Schauern.`
        : wet.length === 0
            ? 'Alle vergleichbaren Modelle bleiben trocken.'
            : `Alle Modelle zeigen Niederschlag; Mengen-Spannweite ${stats.range.toFixed(1)} mm.`;
    return { level, metrics: { ...stats, wetCount: wet.length, dryCount }, reason };
}

function hasComparableData(hour) {
    return finite(hour.surface.windSpeedKmh) ||
        hour.wind.levels.some(level => finite(level.speedKmh)) ||
        finite(hour.clouds.totalPct) ||
        finite(hour.precipitation.amountMm) ||
        finite(hour.radiation.shortwaveWm2);
}

export function assessModelConsensusHour(modelHours, time) {
    const comparable = modelHours.filter(item => item.hour?.time === time && hasComparableData(item.hour));
    const modelCount = comparable.length;
    const wind = evaluateWind(comparable);
    const thermal = evaluateThermal(comparable);
    const clouds = evaluateClouds(comparable);
    const precipitation = evaluatePrecipitation(comparable);
    const components = {
        wind: wind.level,
        thermal: thermal.level,
        thermalHeight: thermal.heightLevel,
        clouds: clouds.level,
        precipitation: precipitation.level
    };

    let level = 'unknown';
    if (modelCount >= THRESHOLDS.minimumModels && wind.level !== 'unknown') {
        const weighted = [
            { level: wind.level, weight: 3 },
            { level: precipitation.level, weight: 2 },
            { level: thermal.level, weight: 1 },
            { level: clouds.level, weight: 1 }
        ].filter(item => item.level !== 'unknown');
        const average = weighted.reduce((sum, item) => sum + LEVEL_RANK[item.level] * item.weight, 0) /
            weighted.reduce((sum, item) => sum + item.weight, 0);
        level = levelFromAverage(average);
        if (wind.level === 'low' || precipitation.level === 'low') level = 'low';
        else if (wind.level === 'medium') level = capLevel(level, 'medium');
        else if (thermal.level === 'low' || clouds.level === 'low') level = capLevel(level, 'medium');
        if (modelCount < THRESHOLDS.highMinimumModels) level = capLevel(level, 'medium');
    }

    const toneFor = componentLevel => componentLevel === 'high'
        ? 'positive'
        : componentLevel === 'low' ? 'negative' : 'neutral';
    const reasons = [
        {
            code: 'model-count',
            tone: modelCount >= THRESHOLDS.highMinimumModels ? 'positive' : 'neutral',
            text: `${modelCount} Modelle mit vergleichbaren Daten.`
        },
        { code: 'wind-consensus', tone: toneFor(wind.level), text: wind.reason },
        { code: 'precipitation-consensus', tone: toneFor(precipitation.level), text: precipitation.reason },
        { code: 'thermal-consensus', tone: toneFor(thermal.level), text: thermal.reason },
        { code: 'cloud-consensus', tone: toneFor(clouds.level), text: clouds.reason }
    ];

    return {
        time,
        level,
        reasons,
        metrics: { wind, thermal: thermal.metrics, clouds: clouds.metrics, precipitation: precipitation.metrics },
        components,
        modelCount,
        models: comparable.map(item => item.model.id)
    };
}

function aggregateComponent(hours, component) {
    const known = hours.filter(item => item.confidence.components[component] !== 'unknown');
    if (known.length === 0) return 'unknown';
    const average = known.reduce((sum, item) =>
        sum + LEVEL_RANK[item.confidence.components[component]] * item.weight, 0) /
        known.reduce((sum, item) => sum + item.weight, 0);
    return levelFromAverage(average);
}

export function aggregateDailyConsensus(hourlyConfidence, primaryAssessments = []) {
    const assessmentByTime = new Map(primaryAssessments
        .filter(item => item?.time)
        .map(item => [item.time, item.assessment]));
    const days = new Map();

    for (const confidence of hourlyConfidence) {
        const [date, timePart] = confidence.time.split('T');
        const hour = Number(timePart?.slice(0, 2));
        if (!Number.isFinite(hour) || hour < 6 || hour > 20) continue;
        const thermalLevel = assessmentByTime.get(confidence.time)?.thermal?.level || 'unknown';
        const weight = THERMAL_LEVEL_RANK[thermalLevel] >= THERMAL_LEVEL_RANK.good
            ? 3
            : hour >= 10 && hour <= 17 ? 2 : 1;
        if (!days.has(date)) days.set(date, []);
        days.get(date).push({ confidence, weight, thermalLevel });
    }

    return [...days.entries()].map(([date, hours]) => {
        const known = hours.filter(item => item.confidence.level !== 'unknown');
        if (known.length === 0) {
            return {
                date,
                level: 'unknown',
                reasons: [{ code: 'daily-data', tone: 'neutral', text: 'Zu wenige vergleichbare Stunden im Flugfenster.' }],
                metrics: { evaluatedHours: 0, flightWindow: '06–20 Uhr' },
                components: { wind: 'unknown', thermal: 'unknown', thermalHeight: 'unknown', clouds: 'unknown', precipitation: 'unknown' },
                modelCount: 0
            };
        }
        const weightedAverage = known.reduce((sum, item) =>
            sum + LEVEL_RANK[item.confidence.level] * item.weight, 0) /
            known.reduce((sum, item) => sum + item.weight, 0);
        let level = levelFromAverage(weightedAverage);
        const modelCount = Math.max(...known.map(item => item.confidence.modelCount));
        if (modelCount < THRESHOLDS.highMinimumModels) level = capLevel(level, 'medium');
        const components = {
            wind: aggregateComponent(known, 'wind'),
            thermal: aggregateComponent(known, 'thermal'),
            thermalHeight: aggregateComponent(known, 'thermalHeight'),
            clouds: aggregateComponent(known, 'clouds'),
            precipitation: aggregateComponent(known, 'precipitation')
        };
        const mostRelevantWeakHour = [...known]
            .sort((a, b) => LEVEL_RANK[a.confidence.level] - LEVEL_RANK[b.confidence.level] || b.weight - a.weight)[0];
        const thermalWeightedHours = known.filter(item => item.weight === 3).length;
        const reasons = [
            {
                code: 'daily-model-count',
                tone: modelCount >= THRESHOLDS.highMinimumModels ? 'positive' : 'neutral',
                text: `${modelCount} Modelle im relevanten Flugfenster verfügbar.`
            },
            {
                code: 'daily-window',
                tone: 'neutral',
                text: thermalWeightedHours > 0
                    ? `${thermalWeightedHours} gute Thermikstunden wurden stärker gewichtet.`
                    : 'Tageswert gewichtet 10–17 Uhr stärker als Randstunden.'
            }
        ];
        if (mostRelevantWeakHour.confidence.level !== 'high') {
            const reason = mostRelevantWeakHour.confidence.reasons.find(item => item.tone === 'negative') ||
                mostRelevantWeakHour.confidence.reasons.find(item => item.code === 'wind-consensus');
            if (reason) reasons.push({ ...reason, code: `daily-${reason.code}` });
        }
        return {
            date,
            level,
            reasons,
            metrics: {
                evaluatedHours: known.length,
                weightedAverage,
                flightWindow: '06–20 Uhr',
                thermalWeightedHours
            },
            components,
            modelCount
        };
    });
}

export function buildForecastConsensus(models, primaryAssessments = []) {
    const times = [...new Set(models.flatMap(model => model.hours.map(hour => hour.time)))].sort();
    const modelHourMaps = models.map(model => ({
        model,
        hours: new Map(model.hours.map(hour => [hour.time, hour]))
    }));
    const hourly = times.map(time => assessModelConsensusHour(
        modelHourMaps
            .map(item => ({ model: item.model, hour: item.hours.get(time) }))
            .filter(item => item.hour),
        time
    ));
    const assessmentSeries = primaryAssessments.map(item => item?.time
        ? item
        : null).filter(Boolean);
    return {
        hourly,
        daily: aggregateDailyConsensus(hourly, assessmentSeries)
    };
}

export function confidenceLevelRank(level) {
    return LEVEL_RANK[level] || 0;
}
