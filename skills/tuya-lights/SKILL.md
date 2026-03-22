---
name: tuya-lights
description: Control Hari's locally configured LSC/Tuya lamps and lamp groups from the workspace Tuya registry. Use when the user asks to turn a lamp or group on/off, dim to a percentage, set white mode, set warmweiß/kaltweiß, change named colors, query lamp status, or onboard/update local Tuya lamps after repair or network changes. Typical triggers: 'Stehlampe an', 'Stehlampe 50%', 'Stehlampe rot', 'Küchenlampe aus', 'alle Lampen aus', 'Vorzimmer an', 'Vorzimmer aus'.
---

Use the files in `C:\Users\1111\.openclaw\workspace\tuya-lights\`.

## Source of truth
- Registry: `tuya_lamps.json`
- CLI: `lamp_control.py`
- Single-device probe: `tuya_test_lamp.py`
- Recovery notes: `KEY_EXTRACTION.md`
- New-device flow: `ONBOARDING.md`

## Command patterns
```powershell
python C:\Users\1111\.openclaw\workspace\tuya-lights\lamp_control.py stehlampe on
python C:\Users\1111\.openclaw\workspace\tuya-lights\lamp_control.py stehlampe brightness --value 50
python C:\Users\1111\.openclaw\workspace\tuya-lights\lamp_control.py stehlampe color --value red
python C:\Users\1111\.openclaw\workspace\tuya-lights\lamp_control.py küche off
python C:\Users\1111\.openclaw\workspace\tuya-lights\lamp_control.py all off
python C:\Users\1111\.openclaw\workspace\tuya-lights\lamp_control.py vorzimmer on
```

## Natural language mapping
- `an` -> `on`
- `aus` -> `off`
- `50%` -> `brightness --value 50`
- `rot/blau/grün/...` -> `color --value <name>`
- `warmweiß` -> `warmwhite`
- `kaltweiß` -> `coldwhite`
- `alle Lampen` -> group `all`
- `Vorzimmer` -> group `vorzimmer`

## Onboarding / repair
If a lamp was repaired, re-paired, or moved to another network, assume the `local_key` may have changed. Read `KEY_EXTRACTION.md` and `ONBOARDING.md`, refresh the key, test with `tuya_test_lamp.py --probe`, then update `tuya_lamps.json`.

## Current live lamps
- `kitchen`
- `livingroom_floor`
- `vorzimmer1`
- `vorzimmer2`
- `vorzimmer3`
- `vorzimmer4`

## Live groups
- `all`
- `vorzimmer`
