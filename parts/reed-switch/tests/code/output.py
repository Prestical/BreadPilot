from machine import Pin
import time

sensor = Pin(16, Pin.OUT)

while True:
    sensor.toggle()
    time.sleep(1)
