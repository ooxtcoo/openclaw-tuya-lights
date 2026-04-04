## How to get local key for Tuya iot devices

## Files
  - tuya_key_grabber.py
  - tuya_key_grabber.js
  - frida-server-17.8.2-android-arm64
  - adb

## Go to dir
cd C:\Users\1111\.openclaw\workspace\FRIDA_HOOK

## Install frida-tools
python -m pip install frida-tools


## Upload and install frida-server on phone.
adb.exe push frida-server-17.8.2-android-arm64
adb.exe install frida-server-17.8.2-android-arm64

## Start frida-server on phone:
.\adb.exe shell "su -c 'cd /data/local/tmp && ./frida-server &'"

  - (allow connection on phone)

## Test (should return the PID)
.\adb.exe shell "su -c 'pidof frida-server'"

<!-- ## find frida on pc: -->
<!-- dir C:\Users\1111\AppData\Roaming\Python\Python312\Scripts\frida* -->
<!-- ## Set the Envoirment Path -->
$env:Path += ";C:\Users\1111\AppData\Roaming\Python\Python312\Scripts"

## Start LSC App on the phone and go the Devices

python tuya_key_grabber.py com.lscsmartconnection.smart C:\Users\1111\.openclaw\workspace\tuya_key_grabber.js

  - tab on the phone in the lsc app devices tab on that device, which you need to grab the local key
  - sometimes it closes and you have to retry!





PS C:\Users\1111\.openclaw\workspace\FRIDA_HOOK> python tuya_key_grabber.py com.lscsmartconnection.smart tuya_key_grabber.js
[*] Starting Frida...
[*] Open lamp pages one by one.
[*] Auto-exit after 5 seconds without a new device.

[*] vorzimmer probe start
[*] Hooked JSONObject.toString
[*] hooks ready

[✓] DEVICE FOUND:

    class       = com.thingclips.smart.sdk.bean.DeviceBean
    devId       = bff6bc4ae8dfd423dfljl1
    name        = Aquarium
    deviceName  = null
    room        = null
    home        = null
    localKey    = xxxx60333172xxxx
    productId   = epfedeubbvlotcjo
    uuid        = xxxx19ea46a0xxxx
    ip          = 192.168.1.101


[✓] DEVICE FOUND:

    class       = com.thingclips.smart.sdk.bean.DeviceBean
    devId       = bf73468c3b945874caufa5
    name        = Battletron Mousepad
    deviceName  = null
    room        = null
    home        = null
    localKey    = xxxx`OH#lO^@xxxx
    productId   = hy57lewrecoee6hv
    uuid        = 2dbf127054fe302e
    ip          = 192.168.1.102


[✓] DEVICE FOUND:

    class       = com.thingclips.smart.sdk.bean.DeviceBean
    devId       = bfc55c8d5520d8c10bovbw
    name        = Kueche Alt
    deviceName  = null
    room        = null
    home        = null
    localKey    = xxxxSNnhJw)Pxxxx
    productId   = ex4ewsy0rowori6r
    uuid        = dba40ba7e4bf8914
    ip          = 192.168.1.103


[✓] DEVICE FOUND:

    class       = com.thingclips.smart.sdk.bean.DeviceBean
    devId       = bf45de5a82eef46206mxtt
    name        = Balkon
    deviceName  = null
    room        = null
    home        = null
    localKey    = xxxxt]saLtW*xxxx
    productId   = 5s0ygsmd6hcirsog
    uuid        = 5aaf04e19c2744a3
    ip          = 192.168.1.104


[✓] DEVICE FOUND:

    class       = com.thingclips.smart.sdk.bean.DeviceBean
    devId       = bf1b87e27d0185eeaecbim
    name        = Kueche
    deviceName  = null
    room        = null
    home        = null
    localKey    = xxxx`@ADz!plxxxx
    productId   = xpaqxtzoftcxrpuu
    uuid        = d52344d9d572b82d
    ip          = 192.168.1.105


[✓] DEVICE FOUND:

    class       = com.thingclips.smart.sdk.bean.DeviceBean
    devId       = bfe838f78a110f3934c1sw
    name        = Stehlampe
    deviceName  = null
    room        = null
    home        = null
    localKey    = xxxx>W1b@5^jxxxx
    productId   = e9adjflivjpn6nax
    uuid        = ef4f9632be42a3e0
    ip          = 192.168.1.106


[✓] DEVICE FOUND:

    class       = com.thingclips.smart.sdk.bean.DeviceBean
    devId       = bf78a3352af712c523yqpa
    name        = PAR16-GL-WIFILIC-TY-RGBCW 9
    deviceName  = null
    room        = null
    home        = null
    localKey    = xxxxf$8t*0>1xxxx
    productId   = e9adjflivjpn6nax
    uuid        = 33c05ea735fd03ea
    ip          = 192.168.1.107


[✓] DEVICE FOUND:

    class       = com.thingclips.smart.sdk.bean.DeviceBean
    devId       = bf0609e687d53813d92wnk
    name        = PAR16-GL-WIFILIC-TY-RGBCW 10
    deviceName  = null
    room        = null
    home        = null
    localKey    = xxxxG@`.*xP+xxxx
    productId   = e9adjflivjpn6nax
    uuid        = 9cddc111c38d7b70
    ip          = 192.168.1.108


[✓] DEVICE FOUND:

    class       = com.thingclips.smart.sdk.bean.DeviceBean
    devId       = bf59fda8c433729edc6eho
    name        = PAR16-GL-WIFILIC-TY-RGBCW 11
    deviceName  = null
    room        = null
    home        = null
    localKey    = xxxx7QpiGnQdxxxx
    productId   = e9adjflivjpn6nax
    uuid        = dcc6918765351b49
    ip          = 192.168.1.109


[✓] DEVICE FOUND:

    class       = com.thingclips.smart.sdk.bean.DeviceBean
    devId       = bf512d269ca6588103nqva
    name        = PAR16-GL-WIFILIC-TY-RGBCW 12
    deviceName  = null
    room        = null
    home        = null
    localKey    = xxxx=-O?$O}nxxxx
    productId   = e9adjflivjpn6nax
    uuid        = a49ddc4a536eb8e8
    ip          = 192.168.1.110


[✓] DEVICE FOUND:

    class       = com.thingclips.smart.sdk.bean.DeviceBean
    devId       = bf74df676395998089nqnm
    name        = Bad
    deviceName  = null
    room        = null
    home        = null
    localKey    = xxxx2Sm=]7NJxxxx
    productId   = ex4ewsy0rowori6r
    uuid        = 1c2745282b79b3fe
    ip          = 192.168.1.111


[*] No new device for 5 seconds. Stopping Frida...
[*] Finished. Found 11 device(s).