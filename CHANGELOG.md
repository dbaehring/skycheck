# Changelog

## 11.0.0-rc.1 – 2026-09-01

### Neu und konsolidiert

- Neues Entscheidungs-Dashboard mit getrenntem Flugcharakter, Thermik-/XC-Potenzial, Föhnrisiko und Modellkonsens.
- Modellvergleich für ICON-D2, ICON-EU, GeoSphere AROME Austria und ECMWF IFS.
- Föhnindikator aus Höhenströmung und modellierter ICON-Prognose des Bozen–Innsbruck-Druckgradienten.
- Zentrale Prognosezeiträume und standortlokale Zeit über `timezone=auto`.

### RC1-Hardening

- Einheitliche Begriffe für alle vier v11-Dimensionen; Legacy-GO/NO-GO bleibt nur im ausdrücklich markierten v10-Bereich.
- Fehlende Primärdaten, Provider-Teilausfälle, niedriger oder fehlender Konsens sowie unbekannte Föhnzustände bleiben sichtbar und werden nicht günstig eingefärbt.
- Offline-Cache und über sechs Stunden alte Prognosen werden mit Herkunft und Warnstatus angezeigt.
- Live-Wind unterscheidet „keine Stationen“ von einem Totalausfall beider Provider; ein einzelner Provider darf weiter ausfallen.
- Daten- und Modellhinweise sowie Föhn-Reality-Check in der Hauptansicht ergänzt.
- Tastaturbedienung für Parameterkarten, Komfortfilter und Windprofilzellen ergänzt.
- Kleine Displays bis 320 px, lange Ortsnamen und Touch-Ziele nachgeschärft.
- Welcome-Dialog scrollt auf Trackpad und Touch als eigener Container; Hintergrundposition und Fokus bleiben beim Schließen erhalten.
- Legacy-v10-Auswertung ist in der normalen Oberfläche entfernt und nur noch mit `?debug=legacy` sichtbar.
- Mobile Scrollcontainer und Pull-to-Refresh nachgeschärft; ein Aktualisieren erhält den gewählten Prognosetag.
- Tagesauswahl vor das Entscheidungs-Dashboard verschoben und Höhenwind-Hinweise um die tatsächliche Modellhöhe ergänzt.
- Föhnrisiko berücksichtigt die lokale Nord-/Südseite relativ zu einem approximierten Alpenhauptkamm.
- Verwaiste Best-Window-Styles und Debug-Ausgaben entfernt; doppelte Dashboard-Renderings reduziert.
- Service-Worker-Cache auf `skycheck-v39` angehoben.
- RC1-Szenarientests A–K für Datenlücken, Offline/Stale, Providerausfälle, Dimensionskonflikte, Zeitzonen und Legacy-Isolation ergänzt.

### Unverändert

- Keine meteorologischen Grenzwerte oder Hard-Blocker wurden für RC1 verändert.
- Modellkonsens verändert weder Flugcharakter noch Thermikbewertung.
