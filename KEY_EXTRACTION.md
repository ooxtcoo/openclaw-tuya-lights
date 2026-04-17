# Key extraction / reverse engineering notes

## Goal

Extract the data needed for local Tuya control from the running **LSC Smart Connect** app:

- `devId`
- `local_key`
- `productId`
- `uuid`
- later via LAN: `ip`, `version`, DPS

## Important findings

- Pure filesystem dumping is usually not enough on current app versions.
- Wireshark often does not reveal the `local_key`.
- The practical path here was: **rooted Android + Frida hooking + running LSC app**.
- After repair or network changes, the `local_key` may change.

## Working flow

1. Connect the phone via **ADB**.
2. Install `frida-tools` locally if needed.
3. Push the matching `frida-server` to the phone and start it as root.
4. Open the LSC app.
5. Attach the Frida script to the running app.
6. Open the target lamp in the app and briefly control it.
7. Read `devId`, `local_key`, `productId`, and `uuid` from the hook logs.
8. Determine the lamp's local IP separately in the LAN.
9. Test with `lampctl <name> status`.
10. Save the working data to `tuya_lamps.json`.

## Why this works

The app keeps decrypted device objects in memory. When a lamp is opened or controlled, those objects pass through the app logic and can be hooked there. That is where `getLocalKey()` / `getDevId()` and related values were captured.

## Known pitfalls

- The app may detect root / hooking, so hide it with Magisk / DenyList if needed.
- The app PID can change, so attach again if necessary.
- `getIp()` from the app object was not reliable here and sometimes returned external addresses, so verify the LAN IP separately.
- Some lamps changed their `local_key` after network repair.

## Proven locally

- Kitchen lamp works locally on **3.3**
- Living room floor lamp works locally on **3.3**
- `all off` worked locally
