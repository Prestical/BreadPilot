from machine import ADC
import time

soil = ADC(26)
DRY = 50000
WET = 25000

while True:
    v = soil.read_u16()
    wet = max(0, min(100, (DRY - v) * 100 // (DRY - WET)))
    print("Soil moisture:", wet, "%")
    time.sleep(2)
