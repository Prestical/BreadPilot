from machine import Pin
import time

door = Pin(16, Pin.IN, Pin.PULL_UP)
led = Pin("LED", Pin.OUT)

while True:
    if door.value() == 1:
        print("The door is open")
    led.value(door.value())
    time.sleep(0.2)
