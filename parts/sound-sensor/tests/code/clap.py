from machine import Pin
import time

mic = Pin(16, Pin.IN)
led = Pin("LED", Pin.OUT)
last = 0

while True:
    if mic.value() == 0 and time.ticks_diff(time.ticks_ms(), last) > 200:
        last = time.ticks_ms()
        led.toggle()
    time.sleep_ms(1)
