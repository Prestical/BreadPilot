from machine import Pin
import time

hall = Pin(16, Pin.IN)
led = Pin("LED", Pin.OUT)
idle = hall.value()

while True:
    led.value(1 if hall.value() != idle else 0)
    time.sleep(0.05)
