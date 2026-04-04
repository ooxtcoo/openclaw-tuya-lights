#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import time
import queue
import threading
import subprocess
from pathlib import Path

FRIDA_EXE = Path(r"C:\Users\1111\AppData\Roaming\Python\Python312\Scripts\frida.exe")
IDLE_TIMEOUT = 10.0

def decode_unicode_escapes(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return value.encode("utf-8").decode("unicode_escape")
    except Exception:
        return value
    
def parse_dev_line(line: str) -> dict[str, str]:
    result = {}

    idx = line.find("[DEV]")
    if idx == -1:
        return result

    payload = line[idx + len("[DEV]"):].strip()

    keys = [
        "class",
        "devId",
        "name",
        "deviceName",
        "room",
        "home",
        "localKey",
        "productId",
        "uuid",
        "ip",
    ]

    for i, key in enumerate(keys):
        marker = key + "="
        start = payload.find(marker)
        if start == -1:
            continue

        start += len(marker)
        end = len(payload)

        for next_key in keys[i + 1:]:
            next_marker = " " + next_key + "="
            pos = payload.find(next_marker, start)
            if pos != -1:
                end = pos
                break

        result[key] = payload[start:end].strip()

    return result


def reader_thread(pipe, output_queue: queue.Queue) -> None:
    try:
        for raw_line in pipe:
            output_queue.put(raw_line.rstrip("\r\n"))
    finally:
        output_queue.put(None)


def main():
    if len(sys.argv) < 3:
        print("Usage: python tuya_key_grabber.py <app-package> <js-hook-file>")
        return 1

    app_package = sys.argv[1]

    base_dir = Path(__file__).resolve().parent
    js_arg = Path(sys.argv[2])
    js_path = js_arg if js_arg.is_absolute() else (base_dir / js_arg).resolve()

    if not FRIDA_EXE.exists():
        print(f"[!] frida.exe not found: {FRIDA_EXE}")
        return 1

    if not js_path.exists():
        print(f"[!] JS hook file not found: {js_path}")
        return 1

    cmd = [
        str(FRIDA_EXE),
        "-U",
        "-N",
        app_package,
        "-l",
        str(js_path),
    ]

    print("[*] Starting Frida...")
    print("[*] Open lamp pages one by one.")
    print(f"[*] Auto-exit after {IDLE_TIMEOUT:.0f} seconds without a new device.\n")

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except Exception as e:
        print(f"[!] Failed to start Frida: {e}")
        return 1

    q: queue.Queue = queue.Queue()
    t = threading.Thread(target=reader_thread, args=(proc.stdout, q), daemon=True)
    t.start()

    seen_dev_ids = set()
    last_new_device_at = time.time()
    started_at = time.time()

    try:
        while True:
            try:
                line = q.get(timeout=0.5)
            except queue.Empty:
                if time.time() - last_new_device_at >= IDLE_TIMEOUT:
                    print(f"\n[*] No new device for {IDLE_TIMEOUT:.0f} seconds. Stopping Frida...")
                    break
                continue

            if line is None:
                break

            if not line:
                continue

            if "[*]" in line or "[!]" in line:
                print(line)

            if "[DEV]" not in line:
                continue

            data = parse_dev_line(line)
            dev_id = data.get("devId")

            if not dev_id:
                print("[!] Found [DEV] line but could not parse devId:")
                print(line)
                continue

            if dev_id in seen_dev_ids:
                continue

            seen_dev_ids.add(dev_id)
            last_new_device_at = time.time()

            print("\n[✓] DEVICE FOUND:\n")
            print(f"    class       = {data.get('class')}")
            print(f"    devId       = {data.get('devId')}")
            print(f"    name        = {decode_unicode_escapes(data.get('name'))}")
            print(f"    deviceName  = {decode_unicode_escapes(data.get('deviceName'))}")
            print(f"    room        = {decode_unicode_escapes(data.get('room'))}")
            print(f"    home        = {decode_unicode_escapes(data.get('home'))}")
            print(f"    localKey    = {data.get('localKey')}")
            print(f"    productId   = {data.get('productId')}")
            print(f"    uuid        = {data.get('uuid')}")
            print(f"    ip          = {data.get('ip')}")
            print()

    except KeyboardInterrupt:
        print("\n[*] Interrupted by user.")
    finally:
        try:
            # proc.terminate()
            proc.wait(timeout=3)
            pass
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    print(f"[*] Finished. Found {len(seen_dev_ids)} device(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())