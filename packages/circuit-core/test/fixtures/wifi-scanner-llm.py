from machine import Pin, I2C
from sh1106 import SH1106_I2C
import time
import network
import random

# Settings
BLINK_DELAY = 0.1
SCAN_DELAY = 2.0
SSID_LIST_MAX = 10

# WiFi credentials (fill in these values)
WIFI_SSID = "your_wifi_ssid"
WIFI_PASSWORD = "your_wifi_password"

# Set up the parts
i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
oled = SH1106_I2C(128, 64, i2c)
btn = Pin(18, Pin.IN, Pin.PULL_UP)

# Main loop
while True:
    # Clear screen
    oled.fill(0)
    oled.text('Wi-Fi Networks', 0, 0)
    oled.show()
    
    # Wait for button press (low = pressed)
    if btn.value() == 0:
        print('Button pressed! Scanning for Wi-Fi...')
        networks = []
        try:
            wlan = network.WLAN(network.STA_IF)
            wlan.active(True)
            wlan.connect(WIFI_SSID, WIFI_PASSWORD)
            time.sleep(1)
            if wlan.isconnected():
                print('Connected to WiFi')
            else:
                print('Failed to connect to WiFi')
                # Scan for networks
                scan_result = wlan.scan()
                if scan_result:
                    for i, net in enumerate(scan_result):
                        if i < SSID_LIST_MAX:
                            ssid = net[0]
                            rssi = net[2]
                            # Simple bar: 0 to 30 dBm → 0 to 10 segments
                            bar = "[" + "█" * (int(abs(rssi) // 3)) + " " * (10 - int(abs(rssi) // 3)) + "]"
                            oled.text(f'{ssid} ({bar})', 0, 10 + i*10)
                else:
                    oled.text('No networks found', 0, 10)
        except Exception as e:
            oled.text('Scan error', 0, 10)
        oled.show()
        time.sleep(SCAN_DELAY)
    time.sleep(0.1)
