# Onboarding new lamps

## Standard flow

1. Connect the lamp to the reachable local Wi-Fi / LAN.
2. Read the `devId` from the LSC app or capture it with the hook.
3. Extract the key from the running app.
4. Verify the lamp's local IP in the LAN.
5. Test the device with `lampctl <name> status`.
6. If needed, verify switching with `lampctl <name> on` / `off`.
7. Store the working data in `tuya_lamps.json`.

## After repair / re-pair

- Always assume the `local_key` may have changed.
- Do not trust the old key.
- Extract the key again.

## Groups

If several lamps are usually switched together:

- add the individual lamps normally in `tuya_lamps.json`
- create a group in `groups`
- example: `hallway` -> `hallway1..4`

## Naming

- groups: `hallway`, `living_room`, `bedroom`
- single lamps: `hallway1`, `hallway2`, ...
- the human-readable display name still lives in JSON as `name`
