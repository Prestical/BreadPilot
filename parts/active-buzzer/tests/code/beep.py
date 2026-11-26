from machine import Pin
import time

buzzer = Pin(16, Pin.OUT, value=1)

for _ in range(3):
    buzzer.value(0)
    time.sleep(0.2)
    buzzer.value(1)
    time.sleep(0.3)
