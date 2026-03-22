import argparse
import json
import sys

try:
    import tinytuya
except ImportError:
    print("tinytuya fehlt. Installiere mit: python -m pip install tinytuya")
    sys.exit(1)


def make_device(device_id, ip, local_key, version):
    d = tinytuya.BulbDevice(device_id, ip, local_key)
    d.set_version(version)
    d.set_socketPersistent(False)
    d.set_socketTimeout(5)
    return d


def try_status(device_id, ip, local_key, versions):
    results = []
    for v in versions:
        try:
            d = make_device(device_id, ip, local_key, v)
            data = d.status()
            results.append({"version": v, "ok": True, "data": data})
        except Exception as e:
            results.append({"version": v, "ok": False, "error": str(e)})
    return results


def set_value(device_id, ip, local_key, version, dp, value):
    d = make_device(device_id, ip, local_key, version)
    return d.set_value(dp, value)


def main():
    ap = argparse.ArgumentParser(description="TinyTuya quick tester for one lamp")
    ap.add_argument("--ip", required=True)
    ap.add_argument("--id", required=True, dest="device_id")
    ap.add_argument("--key", required=True, dest="local_key")
    ap.add_argument("--version", type=float)
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--dp", type=int)
    ap.add_argument("--value")
    args = ap.parse_args()

    if args.probe:
        print(json.dumps(try_status(args.device_id, args.ip, args.local_key, [3.3, 3.4, 3.5]), indent=2, ensure_ascii=False))
        return

    if not args.version or args.dp is None or args.value is None:
        print("Nutze entweder --probe oder gib --version --dp --value an.")
        sys.exit(2)

    val = args.value
    low = val.lower() if isinstance(val, str) else val
    if low == "true":
        val = True
    elif low == "false":
        val = False
    else:
        try:
            val = int(val)
        except Exception:
            pass
    print(set_value(args.device_id, args.ip, args.local_key, args.version, args.dp, val))


if __name__ == "__main__":
    main()
