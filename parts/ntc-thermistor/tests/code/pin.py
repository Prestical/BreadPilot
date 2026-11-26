from machine import Pin
import time

sensor = Pin(26, Pin.IN)

while True:
    print(sensor.read_u16())
    time.sleep(0.5)
