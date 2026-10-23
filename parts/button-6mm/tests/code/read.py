from machine import Pin
import time

button = Pin(16, Pin.IN, Pin.PULL_UP)

while True:
    if button.value() == 0:
        print("pressed")
    time.sleep(0.05)
