from machine import Pin
import time

led = Pin(16, Pin.IN)

while True:
    print(led.value())
    time.sleep(0.5)
