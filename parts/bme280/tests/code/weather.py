from machine import Pin, I2C
from bme280 import BME280
import time

i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
sensor = BME280(i2c)

while True:
    t, p, h = sensor.read()
    print("%.1f C  %.1f hPa" % (t, p))
    if h is not None:
        print("%.0f %% humidity" % h)
    time.sleep(2)
