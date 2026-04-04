# openclaw-tuya-lights

Local Tuya lights control for OpenClaw with **two controller variants in one repo**:

1. **Python controller** (Python variant of the Tuya light controllers)
2. **Go CLI controller** (standalone binary, no Python runtime needed for control)

---

## Project layout

### Shared files
- `tuya_lamps.json` – local device/group registry (commit only sanitized `local_key` values like `xxxx`)
- `tuya_lamps.example.json` – sanitized example registry for git
- `tuya_device_catalog.json` – capability/type metadata used by GUI
- `gui-v1/` – web GUI + local API backend
- `start-gui.bat` – convenience starter

### Python variant
- `lamp_control.py` – Python Tuya controller
- `discover_lamps.py` – Python LAN discovery
- `tuya_test_lamp.py` – low-level lamp test

### Go CLI variant
- `main.go`
- `go.mod`
- `internal/` – CLI + Tuya LAN protocol implementation
- compiled binary expected as `lampctl.exe` (Windows) or `lampctl` (Linux)

---

## How backend mode is selected

The GUI backend auto-detects what is available in the project root:

- if CLI binary exists (`lampctl.exe` on Windows / `lampctl` on Linux) → CLI available
- if `lamp_control.py` + `discover_lamps.py` exist → Python available
- if both exist → both can be selected in GUI
- if only one exists → that one is used

The GUI shows only backend options that are actually available.

---

## Quick start (Windows)

```powershell
cd C:\Users\1111\.openclaw\workspace\tuya-lights\gui-v1
npm install
npm start
```

Open: `http://127.0.0.1:5173`

API backend runs on: `http://127.0.0.1:4890`

---

## Python CLI examples

```powershell
python .\lamp_control.py stehlampe on
python .\lamp_control.py stehlampe off
python .\lamp_control.py stehlampe brightness --value 50
python .\lamp_control.py stehlampe color --value red
python .\lamp_control.py all off
```

---

## Go CLI examples

```powershell
go build -o lampctl.exe .
.\lampctl.exe stehlampe status
.\lampctl.exe stehlampe on
.\lampctl.exe stehlampe brightness --value 50
.\lampctl.exe stehlampe hue --value 180
.\lampctl.exe discover
```

---

## Security / keys

- `tuya_lamps.json` is required by the project, but committed versions must have `local_key` values sanitized (for example `xxxx`).
- Keep real keys local only.
- `tuya_lamps.example.json` is included as an additional sanitized example.
- `FRIDA_HOOK/` contains the files and instructions users need to extract their own local keys for their devices.
- Without a valid `local_key`, local Tuya control will not work.

---

## Notes

The Go CLI variant is the better default choice for most users because it is standalone and does not require Python, extra libraries, or dependency setup.
The Python variant stays in the repo because it is easier to inspect and modify, but it requires Python and the `tinytuya` module.

After re-pairing / network repair, local keys can change.
If control suddenly fails, refresh `local_key` values in local `tuya_lamps.json`.
