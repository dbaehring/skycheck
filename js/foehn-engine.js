/**
 * Phase 3: eigenständige Föhndiagnose.
 *
 * Ein Föhnsignal entsteht nur aus einer Kombination von Druckgradient,
 * alpenquerender Richtung, Stärke, vertikaler Konsistenz und zeitlichem Trend.
 * Es findet keine Gelände-, Lee- oder Rotorberechnung statt.
 */

import { FOEHN_LINKS, FOEHN_REGION, FOEHN_THRESHOLDS } from './foehn-config.js';
import { circularDirectionDifference } from './weather-metrics.js';

const LEVEL_LABELS = Object.freeze({
    low: 'Niedrig',
    elevated: 'Erhöht',
    high: 'Hoch',
    critical: 'Kritisch',
    unknown: 'Unbekannt'
});

function inBounds(location, bounds) {
    const lat = location?.lat;
    const lon = location?.lon;
    return Number.isFinite(lat) && Number.isFinite(lon) &&
        lat >= bounds.minLat && lat <= bounds.maxLat &&
        lon >= bounds.minLon && lon <= bounds.maxLon;
}

export function isFoehnRegionApplicable(location) {
    return inBounds(location, FOEHN_REGION.alps);
}

export function isBozenInnsbruckIndicatorApplicable(location) {
    return inBounds(location, FOEHN_REGION.bozenInnsbruckIndicator);
}

function directionInSector(directionDeg, sector) {
    if (!Number.isFinite(directionDeg)) return false;
    const normalized = ((directionDeg % 360) + 360) % 360;
    return sector.fromDeg <= sector.toDeg
        ? normalized >= sector.fromDeg && normalized <= sector.toDeg
        : normalized >= sector.fromDeg || normalized <= sector.toDeg;
}

function circularMeanDirection(levels) {
    if (levels.length === 0) return null;
    const vector = levels.reduce((sum, level) => {
        const radians = level.directionDeg * Math.PI / 180;
        return {
            x: sum.x + Math.sin(radians),
            y: sum.y + Math.cos(radians)
        };
    }, { x: 0, y: 0 });
    return ((Math.atan2(vector.x, vector.y) * 180 / Math.PI) + 360) % 360;
}

function maximumDirectionSpread(levels) {
    let maximum = 0;
    for (let first = 0; first < levels.length; first++) {
        for (let second = first + 1; second < levels.length; second++) {
            maximum = Math.max(maximum, circularDirectionDifference(
                levels[first].directionDeg,
                levels[second].directionDeg
            ));
        }
    }
    return levels.length >= 2 ? maximum : null;
}

function deriveFlow(hour) {
    const config = FOEHN_THRESHOLDS.flow;
    const availableLevels = config.levels.map(pressureHpa => {
        const level = hour?.wind?.levels?.find(item => item.pressureHpa === pressureHpa);
        return {
            pressureHpa,
            speedKmh: Number.isFinite(level?.speedKmh) ? level.speedKmh : null,
            directionDeg: Number.isFinite(level?.directionDeg) ? level.directionDeg : null
        };
    }).filter(level => level.speedKmh !== null && level.directionDeg !== null);

    const candidates = {};
    for (const [type, sector] of [
        ['south', config.southSector],
        ['north', config.northSector]
    ]) {
        const matchingLevels = availableLevels.filter(level =>
            level.speedKmh >= config.minimumCrossAlpineKmh &&
            directionInSector(level.directionDeg, sector)
        );
        const averageSpeedKmh = matchingLevels.length > 0
            ? matchingLevels.reduce((sum, level) => sum + level.speedKmh, 0) / matchingLevels.length
            : null;
        const directionSpreadDeg = maximumDirectionSpread(matchingLevels);
        const consistency = matchingLevels.length === 3 && directionSpreadDeg <= config.strongConsistencySpreadDeg
            ? 'strong'
            : matchingLevels.length >= 2
                ? 'moderate'
                : 'weak';
        candidates[type] = {
            type,
            matchingLevels,
            matchingLevelCount: matchingLevels.length,
            averageSpeedKmh,
            dominantDirectionDeg: circularMeanDirection(matchingLevels),
            directionSpreadDeg,
            consistency
        };
    }

    const southCount = candidates.south.matchingLevelCount;
    const northCount = candidates.north.matchingLevelCount;
    const type = southCount === 0 && northCount === 0
        ? 'none'
        : southCount === northCount
            ? 'uncertain'
            : southCount > northCount ? 'south' : 'north';
    const selected = type === 'south' || type === 'north'
        ? candidates[type]
        : southCount >= northCount ? candidates.south : candidates.north;

    return {
        availableLevelCount: availableLevels.length,
        availableLevels,
        type,
        selected,
        candidates
    };
}

function pressureSignal(pressure) {
    const delta = Number.isFinite(pressure?.bozenMinusInnsbruckHpa)
        ? pressure.bozenMinusInnsbruckHpa
        : null;
    const magnitudeHpa = delta === null ? null : Math.abs(delta);
    const type = delta === null || magnitudeHpa < FOEHN_THRESHOLDS.pressure.signalHpa
        ? 'none'
        : delta > 0 ? 'south' : 'north';
    return {
        deltaHpa: delta,
        magnitudeHpa,
        type,
        source: delta === null ? null : pressure?.source || 'openMeteoIconPressureMsl'
    };
}

function pressurePoints(magnitudeHpa) {
    const config = FOEHN_THRESHOLDS.pressure;
    if (!Number.isFinite(magnitudeHpa) || magnitudeHpa < config.signalHpa) return config.points[0];
    if (magnitudeHpa < config.supportedHpa) return config.points[1];
    if (magnitudeHpa < config.strongHpa) return config.points[2];
    return config.points[3];
}

function strengthPoints(speedKmh) {
    const config = FOEHN_THRESHOLDS.strength;
    if (!Number.isFinite(speedKmh)) return 0;
    if (speedKmh < config.elevatedKmh) return config.points[0];
    if (speedKmh < config.strongKmh) return config.points[1];
    if (speedKmh < config.criticalKmh) return config.points[2];
    return config.points[3];
}

function deriveTrend(current, previous) {
    if (!previous) return 'unknown';
    const changes = [];
    if (current.pressure.type !== 'none' && previous.pressure.type === current.pressure.type) {
        const difference = current.pressure.magnitudeHpa - previous.pressure.magnitudeHpa;
        if (difference >= FOEHN_THRESHOLDS.trend.pressureChangeHpa) changes.push(1);
        else if (difference <= -FOEHN_THRESHOLDS.trend.pressureChangeHpa) changes.push(-1);
        else changes.push(0);
    }
    if (current.flow.type === 'south' || current.flow.type === 'north') {
        if (previous.flow.type !== current.flow.type) {
            changes.push(1);
        } else {
            const speedDifference = current.flow.selected.averageSpeedKmh - previous.flow.selected.averageSpeedKmh;
            const levelDifference = current.flow.selected.matchingLevelCount - previous.flow.selected.matchingLevelCount;
            if (speedDifference >= FOEHN_THRESHOLDS.trend.windChangeKmh || levelDifference > 0) changes.push(1);
            else if (speedDifference <= -FOEHN_THRESHOLDS.trend.windChangeKmh || levelDifference < 0) changes.push(-1);
            else changes.push(0);
        }
    } else if (previous.flow.type === 'south' || previous.flow.type === 'north') {
        changes.push(-1);
    }
    if (changes.length === 0) return 'unknown';
    const total = changes.reduce((sum, value) => sum + value, 0);
    return total > 0 ? 'increasing' : total < 0 ? 'decreasing' : 'steady';
}

function resolveType(flowType, pressureType) {
    if (flowType === 'uncertain') return 'uncertain';
    if (flowType === 'none') return pressureType;
    if (pressureType === 'none') return flowType;
    return flowType === pressureType ? flowType : 'uncertain';
}

function buildReasons(metrics) {
    const reasons = [];
    if (metrics.pressure.deltaHpa !== null) {
        reasons.push({
            code: 'pressure-gradient',
            signal: metrics.components.pressureGradient,
            text: `Bozen–Innsbruck ${metrics.pressure.deltaHpa >= 0 ? '+' : ''}${metrics.pressure.deltaHpa.toFixed(1)} hPa`
        });
    } else {
        reasons.push({ code: 'pressure-unavailable', signal: 0, text: 'Bozen–Innsbruck-Druckgradient nicht verfügbar' });
    }
    if (metrics.flow.selected.matchingLevelCount > 0) {
        const levelText = metrics.flow.selected.matchingLevels.map(level => level.pressureHpa).join('/');
        reasons.push({
            code: 'cross-alpine-flow',
            signal: metrics.components.crossAlpineFlow,
            text: `${metrics.flow.selected.type === 'north' ? 'Nördliche' : 'Südliche'} alpenquerende Strömung auf ${levelText} hPa`
        });
        reasons.push({
            code: 'flow-strength',
            signal: metrics.components.flowStrength,
            text: `Mittlere relevante Höhenströmung ${Math.round(metrics.flow.selected.averageSpeedKmh)} km/h`
        });
    } else {
        reasons.push({ code: 'no-cross-alpine-flow', signal: 0, text: 'Keine konsistente alpenquerende Höhenströmung' });
    }
    if (metrics.alignment === 'conflicting') {
        reasons.push({ code: 'pressure-flow-conflict', signal: 0, text: 'Druckgradient und Höhenströmung zeigen widersprüchliche Föhnrichtungen' });
    }
    if (metrics.trend !== 'unknown') {
        const labels = { increasing: 'zunehmend', steady: 'gleichbleibend', decreasing: 'abnehmend' };
        reasons.push({ code: 'foehn-trend', signal: metrics.components.temporalTrend, text: `Föhnindikatoren ${labels[metrics.trend]}` });
    }
    return reasons;
}

export function assessFoehn(hour, options = {}) {
    const location = hour?.location;
    if (!isFoehnRegionApplicable(location)) {
        return {
            level: 'low',
            label: LEVEL_LABELS.low,
            type: 'none',
            applicability: 'notApplicable',
            trend: 'unknown',
            reasons: [{ code: 'outside-alps', signal: 0, text: 'Föhnindikator außerhalb des Alpenraums nicht anwendbar' }],
            metrics: { region: 'outsideAlps', officialDiagramUrl: FOEHN_LINKS.officialDiagram },
            confidence: 'high'
        };
    }

    const pressureApplicable = isBozenInnsbruckIndicatorApplicable(location);
    const pressure = pressureApplicable ? pressureSignal(options.pressure) : pressureSignal(null);
    const flow = deriveFlow(hour);
    if (pressure.deltaHpa === null && flow.availableLevelCount === 0) {
        return {
            level: 'unknown',
            label: LEVEL_LABELS.unknown,
            type: 'uncertain',
            applicability: 'applicable',
            trend: 'unknown',
            reasons: [{ code: 'insufficient-foehn-data', signal: null, text: 'Druckgradient und relevantes Höhenwindprofil fehlen' }],
            metrics: {
                region: 'alps',
                pressureIndicatorApplicable: pressureApplicable,
                pressure,
                flow,
                officialDiagramUrl: FOEHN_LINKS.officialDiagram
            },
            confidence: 'low'
        };
    }

    const type = resolveType(flow.type, pressure.type);
    const alignment = pressure.type === 'none' || flow.type === 'none'
        ? 'incomplete'
        : pressure.type === flow.type ? 'aligned' : 'conflicting';
    const flowPoints = FOEHN_THRESHOLDS.flow.matchingLevelPoints[flow.selected.matchingLevelCount];
    const consistencyPoints = flow.selected.consistency === 'strong'
        ? FOEHN_THRESHOLDS.flow.consistencyPoints.strong
        : flow.selected.consistency === 'moderate'
            ? FOEHN_THRESHOLDS.flow.consistencyPoints.moderate
            : 0;
    const current = { pressure, flow, type };
    const previous = options.previousHour ? {
        pressure: pressureSignal(options.previousPressure),
        flow: deriveFlow(options.previousHour)
    } : null;
    const trend = deriveTrend(current, previous);
    const components = {
        pressureGradient: pressurePoints(pressure.magnitudeHpa),
        crossAlpineFlow: flowPoints,
        flowStrength: strengthPoints(flow.selected.averageSpeedKmh),
        verticalConsistency: consistencyPoints,
        temporalTrend: FOEHN_THRESHOLDS.trend.points[trend]
    };
    const score = Math.max(0, Object.values(components).reduce((sum, value) => sum + value, 0));
    const supportedPressure = pressure.magnitudeHpa >= FOEHN_THRESHOLDS.pressure.supportedHpa;
    const strongPressure = pressure.magnitudeHpa >= FOEHN_THRESHOLDS.pressure.strongHpa;
    const consistentFlow = flow.selected.matchingLevelCount >= 2;
    const strongFlow = flow.selected.averageSpeedKmh >= FOEHN_THRESHOLDS.strength.strongKmh;
    const criticalFlow = flow.selected.averageSpeedKmh >= FOEHN_THRESHOLDS.strength.criticalKmh;

    let level = 'low';
    if (score >= FOEHN_THRESHOLDS.levels.elevatedPoints) level = 'elevated';
    if (score >= FOEHN_THRESHOLDS.levels.highPoints && alignment === 'aligned' &&
        supportedPressure && consistentFlow && strongFlow) {
        level = 'high';
    }
    if (score >= FOEHN_THRESHOLDS.levels.criticalPoints && alignment === 'aligned' &&
        strongPressure && flow.selected.matchingLevelCount === 3 && criticalFlow &&
        flow.selected.consistency === 'strong' && trend === 'increasing') {
        level = 'critical';
    }
    if (alignment === 'conflicting' || type === 'uncertain') level = score >= FOEHN_THRESHOLDS.levels.elevatedPoints ? 'elevated' : 'low';
    if (pressure.deltaHpa === null || flow.availableLevelCount < 2) level = level === 'high' || level === 'critical' ? 'elevated' : level;

    const consistentLowSignal = pressure.type === 'none' && flow.type === 'none';
    const confidence = pressure.deltaHpa !== null && flow.availableLevelCount >= 2 &&
        (alignment === 'aligned' || consistentLowSignal)
        ? 'high'
        : flow.availableLevelCount >= 2
            ? 'medium'
            : 'low';
    const metrics = {
        region: 'alps',
        pressureIndicatorApplicable: pressureApplicable,
        pressure,
        pressureDefinition: 'bozenPressureMslHpa - innsbruckPressureMslHpa',
        flow,
        type,
        alignment,
        score,
        components,
        trend,
        officialDiagramUrl: FOEHN_LINKS.officialDiagram,
        terrainCaveat: 'Alpenquerende Strömung kann in komplexem Gelände lokal deutlich stärker wirken als das Modellmittel.'
    };

    return {
        level,
        label: LEVEL_LABELS[level],
        type,
        applicability: 'applicable',
        trend,
        reasons: buildReasons(metrics),
        metrics,
        confidence
    };
}

export function assessFoehnHours(hours, options = {}) {
    const pressureByTime = new Map((options.pressureSeries || []).map(item => [item.time, item]));
    return (hours || []).map((hour, index) => {
        const previousHour = index > 0 ? hours[index - 1] : null;
        const previousTime = previousHour?.time;
        const currentTime = hour?.time;
        const isContiguous = previousTime && currentTime &&
            new Date(currentTime).getTime() - new Date(previousTime).getTime() <= 2 * 60 * 60 * 1000;
        return assessFoehn(hour, {
            pressure: pressureByTime.get(currentTime) || null,
            previousHour: isContiguous ? previousHour : null,
            previousPressure: isContiguous ? pressureByTime.get(previousTime) || null : null
        });
    });
}
