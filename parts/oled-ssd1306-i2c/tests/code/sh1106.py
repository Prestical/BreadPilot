from machine import Pin, I2C
from sh1106 import SH1106_I2C
import time

i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
oled = SH1106_I2C(128, 64, i2c)

while True:
    oled.fill(0)
    oled.text("Hello", 0, 0)
    oled.show()
    time.sleep(1)
