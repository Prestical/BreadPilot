from machine import Pin
import dht
import time

sensor = dht.DHT11(Pin(16))
time.sleep(1)

while True:
    try:
        sensor.measure()
        print("Temperature:", sensor.temperature(), "C  Humidity:", sensor.humidity(), "%")
    except OSError:
        print("Reading failed, trying again")
    time.sleep(2)
