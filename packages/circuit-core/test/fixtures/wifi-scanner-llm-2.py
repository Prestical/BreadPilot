from machine import Pin, I2C
from sh1106 import SH1106_I2C
import time
import network
import random

# Settings
BLINK_DELAY = 0.1
SCAN_TIMEOUT = 2.0
BAR_WIDTH = 6
BAR_HEIGHT = 2
BAR_CHAR = '■'

# Set up the parts
# OLED on I2C0: SDA=GP16, SCL=GP17
i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
oled = SH1106_I2C(128, 64, i2c)

# Button on GP18: pressed = 0, released = 1
btn = Pin(18, Pin.IN, Pin.PULL_UP)

# Main loop
while True:
    # Check if button is pressed
    if btn.value() == 0:
        # Scan for Wi-Fi networks
        wlan = network.WLAN(network.STA_IF)
        wlan.active(True)
        nets = wlan.scan()
        
        # Sort by signal strength (RSSI) strongest first
        nets.sort(key=lambda n: n[3], reverse=True)
        
        # Show top 5 networks
        oled.fill(0)  # Clear screen
        for i, net in enumerate(nets[:5]):
            ssid = net[0].decode('utf-8')
            rssi = net[3]
            sec = 'WPA2' if net[4] == 1 else 'Open' if net[4] == 0 else 'WPA3'
            
            # Limit text to 12 chars
            ssid_text = ssid[:12]
            
            # Draw network name
            y = 8 + (i * 10)
            oled.text(ssid_text, 0, y)
            
            # Draw signal bars (3 bars = strong, 1 bar = weak)
            bar_count = int(abs(rssi) / 10)  # Scale from -90 to 0 → 0 to 9
            bar_count = min(bar_count, 3)  # Max 3 bars
            x_start = 16
            for b in range(bar_count):
                oled.fill_rect(x_start + b * BAR_WIDTH, y + 4, BAR_WIDTH, BAR_HEIGHT, 1)
            
            # Draw password info
            if sec == 'WPA2':
                oled.text('Pass: Yes', 16, y + 16)
            else:
                oled.text('Pass: No', 16, y + 16)
        
        oled.show()  # Display the list
        time.sleep(2)  # Show list for 2 seconds
        
        # After 2 seconds, go back to blank
        oled.fill(0)
        oled.show()
    
    # Small delay to avoid busy loop
    time.sleep(0.01)