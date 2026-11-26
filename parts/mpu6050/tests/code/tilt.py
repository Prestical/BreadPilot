from machine import Pin, I2C
from mpu6050 import MPU6050
import time

i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
mpu = MPU6050(i2c)

while True:
    x, y, z = mpu.acceleration()
    print("x %.2f  y %.2f  z %.2f" % (x, y, z))
    time.sleep(0.2)
