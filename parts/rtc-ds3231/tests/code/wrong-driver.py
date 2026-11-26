from machine import Pin, I2C
import adafruit_ds3231
import time

i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
clock = adafruit_ds3231.DS3231(i2c)

while True:
    print(clock.datetime)
    time.sleep(1)
