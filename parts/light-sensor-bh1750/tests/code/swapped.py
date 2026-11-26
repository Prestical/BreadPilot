from machine import Pin, I2C
import time

i2c = I2C(0, sda=Pin(17), scl=Pin(16), freq=400000)
i2c.writeto(0x23, b"\x10")

while True:
    print(i2c.readfrom(0x23, 2))
    time.sleep(1)
