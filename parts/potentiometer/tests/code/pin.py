from machine import Pin
import time

knob = Pin(26)

while True:
    print(knob.read_u16())
    time.sleep(0.2)
