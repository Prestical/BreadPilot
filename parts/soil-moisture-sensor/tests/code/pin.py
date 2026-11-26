from machine import Pin
import time

soil = Pin(26, Pin.IN)

while True:
    print(soil.read_u16())
    time.sleep(1)
