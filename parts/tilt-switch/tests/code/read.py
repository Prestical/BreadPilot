from machine import Pin
import time

tilt = Pin(16, Pin.IN, Pin.PULL_UP)
led = Pin("LED", Pin.OUT)

while True:
    led.value(tilt.value())
    time.sleep(0.05)
