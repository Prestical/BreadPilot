from machine import Pin
import time

switch = Pin(16, Pin.IN, Pin.PULL_UP)
led = Pin("LED", Pin.OUT)

while True:
    led.value(1 if switch.value() == 0 else 0)
    time.sleep(0.05)
