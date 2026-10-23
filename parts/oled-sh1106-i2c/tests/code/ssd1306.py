from machine import Pin, I2C
from ssd1306 import SSD1306_I2C
import time

i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
oled = SSD1306_I2C(128, 64, i2c)

while True:
    oled.text("Hello", 0, 0)
    oled.show()
    time.sleep(1)
