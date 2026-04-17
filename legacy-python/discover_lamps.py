import json
import sys

try:
    import tinytuya
except ImportError:
    print(json.dumps({"ok": False, "error": "tinytuya fehlt. Installiere mit: python -m pip install tinytuya"}))
    sys.exit(1)


def main():
    # Wait up to ~6s for LAN broadcasts
    devices = tinytuya.deviceScan(False, 6)
    out = []
    for ip, info in (devices or {}).items():
        out.append({
            "ip": ip,
            "gwId": info.get("gwId") or info.get("id"),
            "version": info.get("version"),
            "productKey": info.get("productKey"),
            "name": info.get("name"),
            "raw": info,
        })
    print(json.dumps({"ok": True, "count": len(out), "devices": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
