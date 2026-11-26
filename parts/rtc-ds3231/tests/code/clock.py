from machine import Pin, I2C
from ds3231 import DS3231
import time

i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
clock = DS3231(i2c)

while True:
    year, month, day, hour, minute, second = clock.time()
    print("%02d:%02d:%02d" % (hour, minute, second))
    time.sleep(1)
