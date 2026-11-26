from machine import Pin
import dht
import time

sensor = dht.DHT22(Pin(15))
time.sleep(1)

while True:
    sensor.measure()
    print(sensor.temperature())
    time.sleep(2)
