import argparse
import json
import sys
import colorsys
from pathlib import Path

try:
    import tinytuya
except ImportError:
    print("tinytuya fehlt. Installiere mit: python -m pip install tinytuya")
    sys.exit(1)

CONFIG_PATH = Path(r"C:\Users\1111\.openclaw\workspace\tuya-lights\tuya_lamps.json")

COLOR_MAP = {
    "rot": (255, 0, 0), "red": (255, 0, 0),
    "gruen": (0, 255, 0), "grün": (0, 255, 0), "green": (0, 255, 0),
    "blau": (0, 0, 255), "blue": (0, 0, 255),
    "gelb": (255, 255, 0), "yellow": (255, 255, 0),
    "lila": (180, 0, 255), "purple": (180, 0, 255),
    "pink": (255, 0, 140), "orange": (255, 128, 0),
    "weiss": (255, 255, 255), "weiß": (255, 255, 255), "white": (255, 255, 255),
    "warmweiss": None, "warmweiß": None, "kaltweiss": None, "kaltweiß": None,
}

ALIASES = {
    "kueche": "kitchen", "küche": "kitchen", "kuechenlampe": "kitchen", "küchenlampe": "kitchen", "kitchen": "kitchen",
    "stehlampe": "livingroom_floor", "wohnzimmer": "livingroom_floor", "wohnzimmer-stehlampe": "livingroom_floor", "stehlampe-wohnzimmer": "livingroom_floor", "livingroom_floor": "livingroom_floor",
    "vorzimmer": "vorzimmer", "vorzimmer1": "vorzimmer1", "vorzimmer2": "vorzimmer2", "vorzimmer3": "vorzimmer3", "vorzimmer4": "vorzimmer4",
    "all": "all", "alle": "all",
}


def load_config():
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def resolve_name(name, cfg):
    key = ALIASES.get(name.strip().lower(), name.strip().lower())
    return key


def make_device(cfg):
    d = tinytuya.BulbDevice(cfg["device_id"], cfg["ip"], cfg["local_key"])
    d.set_version(cfg["version"])
    d.set_socketPersistent(False)
    d.set_socketTimeout(5)
    return d


def normalize_percent(value):
    value = int(value)
    return max(0, min(100, value))


def parse_value(value):
    low = value.lower() if isinstance(value, str) else value
    if low == "true":
        return True
    if low == "false":
        return False
    try:
        return int(value)
    except Exception:
        return value


def action_for_lamp(name, lamp_cfg, action, dp=None, value=None):
    if "device_id" not in lamp_cfg or "local_key" not in lamp_cfg or "version" not in lamp_cfg:
        raise ValueError(f"Lampe {name} ist noch nicht vollständig onboarded")
    d = make_device(lamp_cfg)
    dps_cfg = lamp_cfg.get("dps", {})
    power_dp = int(dps_cfg.get("power", 20))
    mode_dp = int(dps_cfg.get("mode", 21))
    brightness_dp = int(dps_cfg.get("brightness", 22))
    temp_dp = int(dps_cfg.get("temp", 23))

    if action == "status":
        return {"lamp": name, "result": d.status()}
    if action == "on":
        return {"lamp": name, "result": d.set_value(power_dp, True)}
    if action == "off":
        return {"lamp": name, "result": d.set_value(power_dp, False)}
    if action == "brightness":
        pct = normalize_percent(value)
        # Ensure powered on + white mode first (many bulbs ignore brightness in colour mode)
        d.set_value(power_dp, True)
        try:
            d.set_value(mode_dp, "white")
        except Exception:
            pass
        result = d.set_brightness_percentage(pct)
        if isinstance(result, dict) and result.get("Error"):
            # fallback for devices expecting raw DP 22 (10..1000)
            raw = max(10, int((pct / 100.0) * 1000))
            result = d.set_value(brightness_dp, raw)
        return {"lamp": name, "result": result}
    if action == "temp":
        pct = normalize_percent(value)
        d.set_value(power_dp, True)
        try:
            d.set_value(mode_dp, "white")
        except Exception:
            pass
        # UI slider semantics: 0=cold .. 100=warm, but this bulb family uses 0=warm .. 1000=cold
        raw = int(((100 - pct) / 100.0) * 1000)
        return {"lamp": name, "result": d.set_value(temp_dp, raw)}
    if action == "white":
        b = normalize_percent(value if value is not None else 100)
        d.set_value(power_dp, True)
        try:
            d.set_value(mode_dp, "white")
        except Exception:
            pass
        d.set_value(brightness_dp, max(10, int((b / 100.0) * 1000)))
        return {"lamp": name, "result": d.set_value(temp_dp, 500)}
    if action == "warmwhite":
        d.set_value(power_dp, True)
        try:
            d.set_value(mode_dp, "white")
        except Exception:
            pass
        # This bulb family uses inverted white-temp scale: 0=warm, 1000=cold
        return {"lamp": name, "result": d.set_value(temp_dp, 0)}
    if action == "coldwhite":
        d.set_value(power_dp, True)
        try:
            d.set_value(mode_dp, "white")
        except Exception:
            pass
        return {"lamp": name, "result": d.set_value(temp_dp, 1000)}
    if action == "color":
        color_name = str(value).strip().lower()
        if color_name not in COLOR_MAP:
            raise ValueError(f"Unbekannte Farbe: {value}")
        mapped = COLOR_MAP[color_name]
        if mapped is None:
            if color_name in ("warmweiss", "warmweiß"):
                return {"lamp": name, "result": d.set_white_percentage(brightness=100, colourtemp=100)}
            return {"lamp": name, "result": d.set_white_percentage(brightness=100, colourtemp=0)}
        r, g, b = mapped
        return {"lamp": name, "result": d.set_colour(r, g, b)}
    if action == "hue":
        hue = int(value)
        if hue < 0:
            hue = 0
        if hue > 360:
            hue = 360
        d.set_value(power_dp, True)
        try:
            d.set_value(mode_dp, "colour")
        except Exception:
            pass
        color_dp = int(dps_cfg.get("color_data", dps_cfg.get("light_param_24", 24)))
        hsv_payload = f"{hue:04x}03e803e8"
        return {"lamp": name, "result": d.set_value(color_dp, hsv_payload)}
    if action == "raw":
        if dp is None or value is None:
            raise ValueError("raw braucht --dp und --value")
        return {"lamp": name, "result": d.set_value(dp, parse_value(value))}
    raise ValueError(f"Unbekannte action: {action}")


def main():
    ap = argparse.ArgumentParser(description="Simple local Tuya lamp control")
    ap.add_argument("lamp", help="lamp/group name from registry")
    ap.add_argument("action", choices=["on", "off", "status", "raw", "brightness", "temp", "color", "hue", "white", "warmwhite", "coldwhite"])
    ap.add_argument("--dp", type=int)
    ap.add_argument("--value")
    args = ap.parse_args()

    cfg = load_config()
    lamps = cfg["lamps"]
    groups = cfg.get("groups", {})
    target = resolve_name(args.lamp, cfg)

    if target in groups:
        if args.action not in {"on", "off", "status"}:
            print("Für Gruppen sind derzeit nur on/off/status erlaubt")
            sys.exit(2)
        results = []
        for lamp_name in groups[target]:
            try:
                results.append(action_for_lamp(lamp_name, lamps[lamp_name], args.action, args.dp, args.value))
            except Exception as e:
                results.append({"lamp": lamp_name, "error": str(e)})
        print(json.dumps(results, indent=2, ensure_ascii=False))
        return

    if target not in lamps:
        print(f"Unbekanntes Ziel: {args.lamp}")
        print("Lampen:", ", ".join(sorted(lamps)))
        print("Gruppen:", ", ".join(sorted(groups)))
        sys.exit(2)

    try:
        print(json.dumps(action_for_lamp(target, lamps[target], args.action, args.dp, args.value), indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"Fehler: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
