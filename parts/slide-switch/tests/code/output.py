from machine import Pin
import time

switch = Pin(16, Pin.OUT)

while True:
    switch.toggle()
    time.sleep(1)
