from machine import Pin
import time

motor = Pin(15, Pin.OUT, value=0)

while True:
    motor.value(1)
    time.sleep(0.2)
    motor.value(0)
    time.sleep(1)
