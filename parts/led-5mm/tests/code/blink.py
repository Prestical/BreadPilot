from machine import Pin
import time

# LED on GP16
led = Pin(16, Pin.OUT)

while True:
    led.toggle()
    time.sleep(0.5)
