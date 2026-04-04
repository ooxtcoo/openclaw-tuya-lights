# Tuya Lights GUI v1

Local professional dashboard for Tuya lamp control.

## Features (v1)
- View all lamps from `../tuya_lamps.json`
- Quick actions: on/off/status
- Add / edit / delete lamps
- Modal editor (professional flow instead of browser prompt)
- Per-lamp brightness slider (auto-apply after 1s idle) + quick color buttons
- Per-lamp color-temperature slider (cold → warm, auto-apply)
- Value sync from live status (DP22/DP23)
- Network discovery (find Tuya devices on LAN and prefill registry entries)
- Group editor + quick group OFF buttons
- JSON registry editor (save back to file)
- Logs for actions and errors

## Run

```powershell
cd C:\Users\1111\.openclaw\workspace\tuya-lights\gui-v1
npm install
npm start
```

Open: `http://127.0.0.1:5173`

Alternative (separate terminals):

```powershell
npm run api
npm run dev
```

API: `http://127.0.0.1:4890`

## Backend modes

The backend can call either the Python controller or the new Go binary.

### Default: Python backend
No extra configuration is needed.

### Go backend via lampctl.exe

```powershell
$env:TUYA_USE_LAMPCTL='1'
$env:LAMPCTL_PATH='C:\Users\1111\.openclaw\workspace\lampctl\lampctl.exe'
npm run api
```

If `LAMPCTL_PATH` is not set, the backend tries this default path:

```text
C:\Users\1111\.openclaw\workspace\lampctl\lampctl.exe
```

## Notes
- Source of truth remains `..\tuya_lamps.json`.
- `tuya_device_catalog.json` is GUI metadata for templates/capabilities and is not required by the CLI runtime itself.
- The backend normalizes discovery results so the GUI can work with both Python and Go discovery.
