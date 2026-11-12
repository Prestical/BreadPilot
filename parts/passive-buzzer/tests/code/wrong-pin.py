from machine import Pin, PWM
import time

Pin(15, Pin.OUT, value=1)
pwm = PWM(Pin(15))
pwm.freq(440)
pwm.duty_u16(32768)
time.sleep(1)
pwm.deinit()
