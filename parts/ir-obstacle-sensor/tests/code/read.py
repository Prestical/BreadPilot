from machine import Pin
import time

obstacle = Pin(16, Pin.IN)
led = Pin("LED", Pin.OUT)

while True:
    blocked = obstacle.value() == 0
    led.value(1 if blocked else 0)
    time.sleep(0.05)
