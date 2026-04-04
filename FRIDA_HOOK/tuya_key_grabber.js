Java.perform(function () {
    function out(s) {
        console.log(s);
    }

    function asciiSafe(v) {
        if (v === null || v === undefined) {
            return "null";
        }

        var s = String(v);
        return s.replace(/[^\x20-\x7E]/g, function (ch) {
            var code = ch.charCodeAt(0).toString(16);
            while (code.length < 4) {
                code = "0" + code;
            }
            return "\\u" + code;
        });
    }

    function safeCall(obj, method) {
        try {
            if (obj && obj[method]) {
                return obj[method]();
            }
        } catch (e) {}
        return null;
    }

    out('[*] vorzimmer probe start');

    try {
        var JSONObject = Java.use('org.json.JSONObject');
        JSONObject.toString.overload().implementation = function () {
            var ret = this.toString();
            if (ret.indexOf('Vorzimmer') !== -1 || ret.indexOf('vorzimmer') !== -1) {
                out('[JSON] ' + ret);
            }
            return ret;
        };
        out('[*] Hooked JSONObject.toString');
    } catch (e) {
        out('[!] JSONObject hook failed: ' + e);
    }

    Java.enumerateLoadedClasses({
        onMatch: function (name) {
            var low = name.toLowerCase();

            if (low.indexOf('tuya') === -1 && low.indexOf('thingclips') === -1) {
                return;
            }

            if (low.indexOf('bean') === -1 && low.indexOf('device') === -1 && low.indexOf('resp') === -1) {
                return;
            }

            try {
                var K = Java.use(name);

                if (K.getDevId) {
                    K.getDevId.overloads.forEach(function (ov) {
                        ov.implementation = function () {
                            var ret = ov.apply(this, arguments);

                            try {
                                var devId = String(ret);
                                var localKey = safeCall(this, 'getLocalKey');
                                var productId = safeCall(this, 'getProductId');
                                var uuid = safeCall(this, 'getUuid');
                                var ip = safeCall(this, 'getIp');
                                var name1 = safeCall(this, 'getName');
                                var name2 = safeCall(this, 'getDeviceName');
                                var room = safeCall(this, 'getRoomName');
                                var home = safeCall(this, 'getHomeName');

                                if (localKey || name1 || name2 || room) {
                                    out(
                                        '[DEV] class=' + asciiSafe(name) +
                                        ' devId=' + asciiSafe(devId) +
                                        ' name=' + asciiSafe(name1) +
                                        ' deviceName=' + asciiSafe(name2) +
                                        ' room=' + asciiSafe(room) +
                                        ' home=' + asciiSafe(home) +
                                        ' localKey=' + asciiSafe(localKey) +
                                        ' productId=' + asciiSafe(productId) +
                                        ' uuid=' + asciiSafe(uuid) +
                                        ' ip=' + asciiSafe(ip)
                                    );
                                }
                            } catch (e) {}

                            return ret;
                        };
                    });
                }
            } catch (e) {}
        },
        onComplete: function () {
            out('[*] hooks ready');
        }
    });
});