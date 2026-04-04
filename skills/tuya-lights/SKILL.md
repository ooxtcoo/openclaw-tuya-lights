---
name: tuya-lights
description: Control Hari's locally configured LSC/Tuya lamps and lamp groups from the workspace Tuya registry. Use when the user asks to turn a lamp or group on/off, dim to a percentage, set white mode, set warmweiß/kaltweiß, change named colors, query lamp status, or onboard/update local Tuya lamps after repair or network changes. Typical triggers: 'Stehlampe an', 'Stehlampe 50%', 'Stehlampe rot', 'Küchenlampe aus', 'alle Lampen aus', 'Vorzimmer an', 'Vorzimmer aus'.
---

This skill may be installed outside the Tuya project directory, so do not assume the project root is relative to this SKILL.md.

Use these default project locations first:

- Windows: `%USERPROFILE%\.openclaw\workspace\tuya-lights`
- Linux / Android / Termux: `~/src/tuya-lights`

If the local installation uses a different location, adjust this SKILL.md to match the actual project path.

Prefer the Go CLI variant:

- Windows: `lampctl.exe`
- Linux / Android / Termux: `lampctl`

Use Python only as fallback when the CLI binary is not available.

## Source of truth
- Registry: `tuya_lamps.json`
- Preferred CLI: `lampctl.exe` (Windows) or `lampctl` (Linux/Android)
- Python fallback: `lamp_control.py`
- Single-device probe: `tuya_test_lamp.py`
- Recovery notes: `KEY_EXTRACTION.md`
- New-device flow: `ONBOARDING.md`

## Command patterns
```bash
# Linux / Android / Termux
~/src/tuya-lights/lampctl stehlampe on
~/src/tuya-lights/lampctl stehlampe brightness --value 50
~/src/tuya-lights/lampctl stehlampe color --value red
~/src/tuya-lights/lampctl küche off
~/src/tuya-lights/lampctl all off
~/src/tuya-lights/lampctl vorzimmer on

# Windows PowerShell / CMD equivalent
"%USERPROFILE%\\.openclaw\\workspace\\tuya-lights\\lampctl.exe" stehlampe on

# Python fallback only if CLI is unavailable
python lamp_control.py stehlampe on
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
If a lamp was repaired, re-paired, or moved to another network, assume the `local_key` may have changed. Read `KEY_EXTRACTION.md` and `ONBOARDING.md`, refresh the key, test with the preferred CLI first (`lampctl <lamp> status`), then use `tuya_test_lamp.py --probe` if Python fallback is needed, and finally update `tuya_lamps.json`.

## Portability note
This skill intentionally prefers explicit standard project paths so it can still work after being copied into a separate OpenClaw skills directory. If a local installation uses a different layout, update this SKILL.md so the binary and project paths match that environment.

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
