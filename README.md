# SkyCheck v11 RC1

SkyCheck ist eine statische Progressive Web App zur Einordnung von Gleitschirm-Wetterprognosen. Das Entscheidungs-Dashboard hält vier Dimensionen bewusst getrennt: Flugcharakter, Thermik & XC, Föhnrisiko und Modellkonsens. Es erteilt keine Startfreigabe.

## Daten und Modelle

- Open-Meteo stellt die Vorhersagedaten bereit.
- Das Primärmodell nutzt regional ICON-D2 oder ICON-EU und außerhalb dieser Abdeckung ein globales Modell.
- Der Modellkonsens vergleicht, soweit am Standort verfügbar, ICON-D2, ICON-EU, GeoSphere AROME Austria und ECMWF IFS.
- Der Bozen–Innsbruck-Druckgradient ist eine ICON-Prognose via Open-Meteo. Er ist keine aktuelle Stationsmessung; das offizielle Föhndiagramm ist als Reality Check verlinkt.
- OpenWindMap und alpine Lawinenwarndienste liefern ergänzende Live-Winddaten.

## Lokal starten und prüfen

SkyCheck hat keinen Build-Schritt und keine Laufzeitabhängigkeiten. Wegen ES-Modulen und Service Worker muss die App über HTTP laufen:

```sh
python3 -m http.server 8000
```

Danach `http://localhost:8000` öffnen. Die Node-Tests laufen mit:

```sh
npm test
```

Vor einer Veröffentlichung zusätzlich `git diff --check` ausführen und Desktop, Mobilansicht, Tastaturbedienung, Hell/Dunkel, hohen Kontrast, Standortwahl, Offline-Reload und Provider-Teilausfälle im Browser prüfen.

## Struktur

- `index.html`: UI-Shell und deutsche Erklärungstexte
- `css/styles.css`: Layout, Responsive Design und Zustandsdarstellung
- `js/main.js`: Start und Ereignisbehandlung
- `js/weather.js`: Primärdaten und zentrale Assessments
- `js/safety-engine.js`, `js/thermal-engine.js`, `js/foehn-engine.js`: getrennte Bewertungsdimensionen
- `js/model-consensus.js`: Prognoseübereinstimmung ohne Einfluss auf Safety oder Thermik
- `js/dashboard.js`: reines v11-View-Model ohne neuen Gesamtscore
- `js/forecast-periods.js`: zentrale fachlich begründete Zeiträume
- `sw.js`: statische Assets und sichtbarer Offline-Cache-Fallback

## Grenzen

Modelle können lokale Tal-, Lee-, Rotor- und Startplatzeffekte nicht zuverlässig auflösen. Fehlende, alte oder widersprüchliche Daten werden als `Unklar` beziehungsweise als Offline-/Stale-Zustand angezeigt und dürfen nicht als günstige Prognose gelesen werden. SkyCheck ersetzt weder Wetterbriefing noch Vor-Ort-Beurteilung; die Flugentscheidung bleibt beim Piloten.

## Veröffentlichung

Das Repository kann unverändert auf einem statischen HTTPS-Host veröffentlicht werden. Bei Änderungen an gecachten Assets muss die Cache-Version in `sw.js` erhöht werden. `manifest.json`, sichtbare Versionsangaben, `APP_INFO.version` und `CHANGELOG.md` sind für Releases gemeinsam zu prüfen.
