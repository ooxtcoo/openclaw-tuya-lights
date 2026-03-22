# Key Extraction / Reverse Engineering Notes

## Ziel
Aus der laufenden **LSC Smart Connect** App die für lokale Tuya-Steuerung nötigen Daten ziehen:
- `devId`
- `local_key`
- `productId`
- `uuid`
- später per LAN zusätzlich: `ip`, `version`, DPS

## Wichtige Erkenntnisse
- Reines Filesystem-Dumping der App reicht bei aktuellen Versionen meist **nicht**.
- Wireshark liefert oft nicht den `local_key`.
- Der brauchbare Weg war hier: **gerootetes Android + Frida Hooking + laufende LSC-App**.
- Nach Repair / Netzwerkwechsel kann sich der `local_key` ändern.

## Erfolgreicher Flow
1. Handy per **ADB** verbinden.
2. Falls nötig `frida-tools` lokal installieren.
3. Passenden `frida-server` auf das Handy pushen und per Root starten.
4. LSC-App öffnen.
5. Frida-Skript an die laufende App hängen.
6. In der App die gewünschte Lampe öffnen und kurz bedienen (an/aus, Helligkeit, Farbe).
7. In den Hook-Logs `devId`, `local_key`, `productId`, `uuid` ablesen.
8. Lokale IP der Lampe separat im LAN ermitteln.
9. Mit `tuya_test_lamp.py --probe` Version testen.
10. Erfolgreiche Daten in `tuya_lamps.json` eintragen.

## Warum das funktioniert
Die App hält die entschlüsselten Geräteobjekte im RAM. Beim Öffnen/Steuern einer Lampe laufen diese Objekte durch die App-Logik und lassen sich hooken. Genau dort konnten `getLocalKey()` / `getDevId()` etc. abgegriffen werden.

## Bekannte Stolpersteine
- App erkennt Root/Hooking manchmal → in Magisk verstecken / DenyList nutzen.
- App-PID wechselt manchmal → frisch attachen.
- `getIp()` aus dem App-Objekt war hier **nicht zuverlässig** und zeigte teils externe Adressen; LAN-IP separat verifizieren.
- Bei manchen Lampen änderte sich der `local_key` nach Netzwerk-Repair.

## Bereits bewiesen
- Küchenlampe lokal auf **3.3** steuerbar
- Stehlampe Wohnzimmer lokal auf **3.3** steuerbar
- `all off` lokal erfolgreich
