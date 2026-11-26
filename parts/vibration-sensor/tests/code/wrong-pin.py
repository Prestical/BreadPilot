from machine import Pin
import time

sensor = Pin(15, Pin.IN)

while True:
    print(sensor.value())
    time.sleep(0.5)
