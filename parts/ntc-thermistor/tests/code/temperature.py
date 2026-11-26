from machine import ADC
import math
import time

ntc = ADC(26)

while True:
    v = sum(ntc.read_u16() for _ in range(8)) // 8
    if v > 0:
        r = 10000 * (65535 - v) / v
        t = 1 / (1 / 298.15 + math.log(r / 10000) / 3950) - 273.15
        print("Temperature:", round(t, 1), "C")
    time.sleep(1)
