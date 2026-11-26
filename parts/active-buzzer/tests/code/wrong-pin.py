from machine import Pin
import time

buzzer = Pin(15, Pin.OUT, value=1)

while True:
    buzzer.value(0)
    time.sleep(0.2)
    buzzer.value(1)
    time.sleep(1)
