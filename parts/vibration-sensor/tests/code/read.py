from machine import Pin
import time

vib = Pin(16, Pin.IN)
led = Pin("LED", Pin.OUT)
idle = vib.value()
last = 0

while True:
    if vib.value() != idle and time.ticks_diff(time.ticks_ms(), last) > 200:
        last = time.ticks_ms()
        led.toggle()
    time.sleep_ms(1)
