# Tuya Lights GUI v1

Local professional dashboard for Tuya lamp control.

## Features (v1)
- View all lamps from `../tuya_lamps.json`
- Quick actions: on/off/status
- Add / edit / delete lamps
- Modal editor (professional flow instead of browser prompt)
- Per-lamp brightness slider (auto-apply after 1s idle) + quick color buttons
- Per-lamp color-temperature slider (kalt→warm, auto-apply)
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

## Notes
- Backend calls `..\lamp_control.py` directly.
- Source of truth remains `..\tuya_lamps.json`.
- This keeps voice + skill + GUI aligned.
