# Onboarding neuer Lampen

## Standardablauf
1. Lampe ins erreichbare WLAN/LAN bringen.
2. `devId` in der LSC-App nachsehen oder im Hook mitloggen.
3. Key per Frida aus der laufenden App ziehen.
4. Lokale IP der Lampe im LAN prüfen.
5. Mit `tuya_test_lamp.py --probe` gegen die IP testen.
6. Erfolgreiche Kombination in `tuya_lamps.json` eintragen.
7. Mit `lamp_control.py <name> on/off/status` verifizieren.

## Wenn Repair / Re-Pair nötig war
- Immer davon ausgehen, dass der `local_key` neu sein könnte.
- Alten Key nicht vertrauen.
- Key frisch extrahieren.

## Gruppen
Wenn mehrere Lampen fast immer gemeinsam geschaltet werden:
- einzelne Lampen normal in `tuya_lamps.json` eintragen
- zusätzlich Gruppe in `groups` anlegen
- Beispiel: `vorzimmer` -> `vorzimmer1..4`

## Namensschema
- Gruppen: `vorzimmer`, `wohnzimmer`, `schlafzimmer`
- Einzellampen: `vorzimmer1`, `vorzimmer2`, ...
- Menschenlesbarer Anzeigename bleibt zusätzlich im JSON.
