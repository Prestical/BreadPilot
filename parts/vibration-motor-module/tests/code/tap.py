from machine import Pin
import time

motor = Pin(16, Pin.OUT, value=0)

for _ in range(2):
    motor.value(1)
    time.sleep(0.2)
    motor.value(0)
    time.sleep(0.3)
