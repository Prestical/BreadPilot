from machine import Pin
import time

button = Pin(16, Pin.OUT)

while True:
    button.value(1)
    time.sleep(0.05)
