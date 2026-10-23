from machine import Pin, I2C
from sh1106 import SH1106_I2C
import network
import time

# Settings
MAX_LINES = 7       # 8 text lines on the screen; line 0 is the title
SHOW_SECONDS = 10   # how long the list stays on the screen

# Set up the parts
i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
oled = SH1106_I2C(128, 64, i2c)
button = Pin(18, Pin.IN, Pin.PULL_UP)  # reads 0 while pressed
wlan = network.WLAN(network.STA_IF)
wlan.active(True)  # scanning works without connecting to a network


def ssid_text(raw):
    # SSIDs are bytes; the screen font only has plain ASCII letters
    try:
        name = raw.decode()
    except UnicodeError:
        name = "?"
    name = "".join(c if 32 <= ord(c) < 127 else "?" for c in name)
    return name or "(hidden)"


def bars(rssi):
    # -50 dBm or stronger = 4 bars, -90 dBm or weaker = 0
    return max(0, min(4, (rssi + 90) // 10))


def show_ready():
    oled.fill(0)
    oled.text("Wi-Fi scanner", 0, 0)
    oled.text("Press the button", 0, 24)
    oled.show()


# Main loop
show_ready()
while True:
    if button.value() == 0:
        oled.fill(0)
        oled.text("Scanning...", 0, 0)
        oled.show()
        nets = wlan.scan()  # each: (ssid, bssid, channel, RSSI, security, hidden)
        nets.sort(key=lambda n: n[3], reverse=True)  # strongest first
        oled.fill(0)
        oled.text("Found %d" % len(nets), 0, 0)
        for i, net in enumerate(nets[:MAX_LINES]):
            y = 8 + i * 8
            oled.text(ssid_text(net[0])[:11], 0, y)  # 11 letters for the name
            oled.text("|" * bars(net[3]), 96, y)  # signal bars on the right
        oled.show()
        time.sleep(SHOW_SECONDS)
        show_ready()
    time.sleep(0.05)
