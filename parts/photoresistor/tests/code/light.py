from machine import ADC, Pin
import time

light = ADC(26)
led = Pin("LED", Pin.OUT)

while True:
    level = light.read_u16()
    print(level)
    led.value(1 if level < 20000 else 0)
    time.sleep(0.5)
