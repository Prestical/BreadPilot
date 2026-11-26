from machine import Pin
import time

touch = Pin(16, Pin.IN)
led = Pin("LED", Pin.OUT)
time.sleep(0.5)

while True:
    led.value(touch.value())
    time.sleep(0.05)
