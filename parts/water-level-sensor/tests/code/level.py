from machine import ADC, Pin
import time

water = ADC(26)
led = Pin("LED", Pin.OUT)

while True:
    level = water.read_u16()
    print("Water:", level)
    led.value(1 if level > 10000 else 0)
    time.sleep(1)
