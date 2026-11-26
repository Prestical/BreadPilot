from machine import Pin
import onewire
import ds18x20
import time

ds = ds18x20.DS18X20(onewire.OneWire(Pin(15)))
roms = ds.scan()

while True:
    ds.convert_temp()
    time.sleep_ms(750)
    print(ds.read_temp(roms[0]))
