from machine import Pin, I2C
import time

i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
i2c.writeto(0x23, b"\x10")
time.sleep_ms(180)

while True:
    data = i2c.readfrom(0x23, 2)
    print("Light:", (data[0] << 8 | data[1]) / 1.2, "lux")
    time.sleep(1)
