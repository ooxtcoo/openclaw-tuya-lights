# openclaw-tuya-lights

Local Tuya lights control and web GUI for OpenClaw, with voice-friendly device registry, discovery, capabilities, and local LAN control.

## Inhalt
- `tuya_lamps.json` – Registry aller bekannten Lampen und Gruppen
- `tuya_device_catalog.json` – lokaler Capability-/Typ-Katalog für bulb/plug/switch + spätere productKey-Mappings
- `lamp_control.py` – lokales Steuer-CLI für on/off/status/brightness/color/group actions
- `tuya_test_lamp.py` – Roh-Tester für eine einzelne Lampe per IP/devId/local_key
- `start-gui.bat` – startet GUI/API bequem und öffnet den Browser automatisch
- `KEY_EXTRACTION.md` – dokumentiert exakt, wie die Keys aus der LSC-App geholt wurden
- `ONBOARDING.md` – kurzer Ablauf für neue oder neu gepairte Lampen
- `skills/tuya-lights/SKILL.md` – Skill, damit Atlas Lampenbefehle direkt versteht

## Schnellbefehle
```powershell
python C:\Users\1111\.openclaw\workspace\tuya-lights\lamp_control.py stehlampe on
python C:\Users\1111\.openclaw\workspace\tuya-lights\lamp_control.py stehlampe off
python C:\Users\1111\.openclaw\workspace\tuya-lights\lamp_control.py stehlampe brightness --value 50
python C:\Users\1111\.openclaw\workspace\tuya-lights\lamp_control.py stehlampe color --value red
python C:\Users\1111\.openclaw\workspace\tuya-lights\lamp_control.py all off
```

## Aktuell bekannte Lampen
- `kitchen` – Küchenlampe
- `livingroom_floor` – Stehlampe Wohnzimmer
- `vorzimmer1`
- `vorzimmer2`
- `vorzimmer3`
- `vorzimmer4`
- Gruppe `vorzimmer`

## Device catalog / capability layer

- Der lokale Katalog `tuya_device_catalog.json` normalisiert Gerätetypen (`bulb`, `plug`, `switch`, fallback `device`).
- Die GUI nutzt ihn für freundliche Typnamen, Icons und um nur passende Controls anzuzeigen.
- Unter `product_keys` kann später gezielt gemappt werden: `productKey -> template/type/model/image`.
- So können wir Tuya-Developer-Infos schrittweise lokal übernehmen, ohne Cloud-Zwang.

## GUI bequem starten

Einfach doppelklicken:

```bat
start-gui.bat
```

Das Skript startet `gui-v1` via `npm start` in einem neuen Terminal und öffnet danach automatisch `http://127.0.0.1:5173` im Browser.

## Wichtige Regel
Nach Repair / Re-Pair / Netzwerkwechsel kann sich der `local_key` ändern. Dann immer den Key neu extrahieren und `tuya_lamps.json` aktualisieren.
