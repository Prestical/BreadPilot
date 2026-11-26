from machine import Pin, I2C
from mpu6050 import MPU6050
import time

i2c = I2C(0, sda=Pin(17), scl=Pin(16), freq=400000)
mpu = MPU6050(i2c)

while True:
    print(mpu.acceleration())
    time.sleep(0.2)
