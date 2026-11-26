from machine import Pin
import time

line = Pin(16, Pin.IN)
led = Pin("LED", Pin.OUT)

while True:
    led.value(line.value())
    time.sleep(0.05)
