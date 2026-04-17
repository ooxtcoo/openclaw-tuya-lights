# Tuya Lights GUI v1

Clean local dashboard for Tuya lamp control.

## Features

- view all lamps from `../tuya_lamps.json`
- quick actions: on / off / status
- add / edit / delete lamps
- drag-and-drop lamp ordering
- visual group management
- per-lamp brightness, white temperature, and color controls
- discovery scan for Tuya devices on the local network
- registry diagnostics and repair tools
- raw JSON and log panels hidden behind collapsible sections
- German / English language switcher

## Run

```powershell
cd C:\Users\1111\.openclaw\workspace\tuya-lights\gui-v1
npm install
npm start
```

Open: `http://127.0.0.1:5173`

Alternative:

```powershell
npm run api
npm run dev
```

API: `http://127.0.0.1:4890`

## Runtime model

The GUI backend now uses the Go CLI only.
There is no active Python backend path anymore.

## Notes

- Source of truth remains `../tuya_lamps.json`.
- `tuya_device_catalog.json` is GUI metadata for templates and capabilities.
- The backend normalizes the registry on load/save.
- Discovery is executed through `lampctl discover`.
