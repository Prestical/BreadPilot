from machine import Pin
import adafruit_dht
import time

sensor = adafruit_dht.DHT11(Pin(16))

while True:
    print(sensor.temperature, sensor.humidity)
    time.sleep(2)
