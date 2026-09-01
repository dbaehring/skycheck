import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clearLiveWindCache,
    fetchNearbyLiveWind
} from '../js/weather.js';

const LOCATION = { lat: 47.73, lon: 12.46 };

function response(data, ok = true) {
    return { ok, status: ok ? 200 : 503, json: async () => data };
}

test('Live-Wind verfügbar: aktuelle Station wird normalisiert und angezeigt', async () => {
    clearLiveWindCache();
    const fetchImpl = async url => url.includes('pioupiou')
        ? response({ data: [{
            id: 42,
            meta: { name: 'Teststation' },
            location: { latitude: 47.74, longitude: 12.47, altitude: 780 },
            measurements: {
                date: new Date().toISOString(),
                wind_speed_avg: 12,
                wind_speed_max: 18,
                wind_speed_min: 7,
                wind_heading: 270
            }
        }] })
        : response({ features: [] });

    const stations = await fetchNearbyLiveWind(LOCATION.lat, LOCATION.lon, 30, 8, { fetchImpl });
    assert.equal(stations.length, 1);
    assert.equal(stations[0].name, 'Teststation');
    assert.equal(stations[0].source, 'openwindmap');
});

test('Live-Wind leer: erreichbare Provider ohne nahe Stationen ergeben eine leere Liste', async () => {
    clearLiveWindCache();
    const fetchImpl = async url => url.includes('pioupiou')
        ? response({ data: [] })
        : response({ features: [] });
    const stations = await fetchNearbyLiveWind(LOCATION.lat, LOCATION.lon, 30, 8, { fetchImpl });
    assert.deepEqual(stations, []);
});

test('Live-Wind Teil- und Totalausfall bleiben unterscheidbar', async () => {
    clearLiveWindCache();
    const partialFetch = async url => {
        if (url.includes('pioupiou')) throw new Error('OWM ausgefallen');
        return response({ features: [] });
    };
    assert.deepEqual(
        await fetchNearbyLiveWind(LOCATION.lat, LOCATION.lon, 30, 8, { fetchImpl: partialFetch, warn: () => {} }),
        []
    );

    clearLiveWindCache();
    await assert.rejects(
        fetchNearbyLiveWind(LOCATION.lat, LOCATION.lon, 30, 8, {
            fetchImpl: async () => { throw new Error('Netzwerk ausgefallen'); },
            warn: () => {}
        }),
        /Live-Wind-Provider nicht erreichbar/
    );
});
