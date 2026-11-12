from machine import Pin, PWM
import time

# This buzzer is ON while its pin is LOW: keep the pin HIGH when quiet.
Pin(16, Pin.OUT, value=1)


def beep(freq, ms):
    pwm = PWM(Pin(16))
    pwm.freq(freq)
    pwm.duty_u16(32768)
    time.sleep_ms(ms)
    pwm.deinit()
    Pin(16, Pin.OUT, value=1)


while True:
    for note in (262, 330, 392, 523):
        beep(note, 200)
        time.sleep_ms(50)
    time.sleep(2)
