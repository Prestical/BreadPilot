from machine import Pin
import time

water = Pin(26, Pin.IN)

while True:
    print(water.read_u16())
    time.sleep(1)
