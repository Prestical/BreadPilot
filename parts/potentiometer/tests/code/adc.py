from machine import ADC
import time

knob = ADC(26)

while True:
    print(knob.read_u16())
    time.sleep(0.2)
