Java.perform(function () {
  function out(s) { console.log(s); }
  function safeCall(obj, method) {
    try {
      if (obj && obj[method]) return obj[method]();
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
      if (low.indexOf('tuya') === -1 && low.indexOf('thingclips') === -1) return;
      if (low.indexOf('bean') === -1 && low.indexOf('device') === -1 && low.indexOf('resp') === -1) return;
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
                  out('[DEV] class=' + name + ' devId=' + devId + ' name=' + name1 + ' deviceName=' + name2 + ' room=' + room + ' home=' + home + ' localKey=' + localKey + ' productId=' + productId + ' uuid=' + uuid + ' ip=' + ip);
                }
              } catch (e) {}
              return ret;
            };
          });
        }
      } catch (e) {}
    },
    onComplete: function () { out('[*] hooks ready'); }
  });
});
