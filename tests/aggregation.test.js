import test from 'node:test';
import assert from 'node:assert/strict';

import {
    V10_TIME_WINDOWS,
    findBestWindowForHours,
    getDayTrafficLightFromAssessments,
    summarizeFavoriteDay
} from '../js/aggregation.js';
import { createDay } from './helpers.js';

const day = '2026-08-31';

test('v10-Zeitfenster sind explizit dokumentiert', () => {
    assert.deepEqual(V10_TIME_WINDOWS.timeline, { start: 6, end: 20 });
    assert.deepEqual(V10_TIME_WINDOWS.categorySummary, { start: 8, end: 18 });
    assert.deepEqual(V10_TIME_WINDOWS.favoriteSummary, { start: 6, end: 20 });
});

test('Stunden-Timeline und bestes Flugfenster erhalten das längste grüne Fenster', () => {
    const data = createDay(day, [2, 3, 3, 2, 3, 3, 3, 2, 1, 2, 2, 2, 2, 2, 2]);
    assert.deepEqual(findBestWindowForHours(data.hours, data.assessments, day), {
        start: 10, end: 12, indices: [4, 5, 6]
    });
});

test('Tageskarte: mindestens drei grüne Stunden ergeben GO', () => {
    const data = createDay(day, [2, 2, 3, 3, 3, 2, 1, 2, 2, 2, 2, 2, 2, 2, 2]);
    assert.deepEqual(getDayTrafficLightFromAssessments(data.hours, data.assessments, day), { status: 'go', label: 'GO' });
});

test('Tageskarte: ein grüner Slot bleibt VORSICHT', () => {
    const data = createDay(day, [1, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    assert.equal(getDayTrafficLightFromAssessments(data.hours, data.assessments, day).status, 'caution');
});

test('Tageskarte: ohne Grün und mit Rot ergibt NO-GO', () => {
    const data = createDay(day, [2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    assert.equal(getDayTrafficLightFromAssessments(data.hours, data.assessments, day).status, 'nogo');
});

test('Favoriten behalten Worst-Score plus bestes grünes Fenster', () => {
    const data = createDay(day, [2, 3, 3, 2, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    const result = summarizeFavoriteDay(data.hours, data.assessments, day);
    assert.equal(result.worstScore, 1);
    assert.deepEqual(result.bestWindow, { start: 7, end: 8, indices: [1, 2] });
});

