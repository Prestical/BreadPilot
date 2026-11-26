from machine import Pin
import time

flame = Pin(16, Pin.IN)
led = Pin("LED", Pin.OUT)

while True:
    if flame.value() == 0:
        print("Flame!")
        led.value(1)
    else:
        led.value(0)
    time.sleep(0.1)
