from machine import Pin
import onewire
import ds18x20
import time

ds = ds18x20.DS18X20(onewire.OneWire(Pin(16)))
roms = ds.scan()

while True:
    ds.convert_temp()
    time.sleep_ms(750)
    for rom in roms:
        print("Temperature:", ds.read_temp(rom), "C")
    time.sleep(1)
