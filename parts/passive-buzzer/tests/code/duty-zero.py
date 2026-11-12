from machine import Pin, PWM
import time

buzzer = PWM(Pin(16))

while True:
    buzzer.freq(1000)
    buzzer.duty_u16(32768)
    time.sleep(0.2)
    buzzer.duty_u16(0)
    time.sleep(1)
