from machine import Pin, I2C
import adafruit_bme280
import time

i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
sensor = adafruit_bme280.Adafruit_BME280_I2C(i2c)

while True:
    print(sensor.temperature)
    time.sleep(2)
