from machine import Pin
import dht
import time

sensor = dht.DHT11(Pin(15))
time.sleep(1)

while True:
    sensor.measure()
    print(sensor.temperature(), sensor.humidity())
    time.sleep(2)
