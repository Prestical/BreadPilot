# Raspberry Pi Pico 2 W pinout (generated from verified data, do not edit)

Variants: pico-2-w, pico-2-wh. GPIO logic level is 3.3 V. Never connect 5 V to a GPIO.
Pin numbering: with the USB connector at the top, pin 1 is top-left, pins 1-20 run down the left side and pins 21-40 run up the right side (pin 40 is top-right).

## Summary
- Analog input (ADC) pins: GP26 (pin 31, ADC0), GP27 (pin 32, ADC1), GP28 (pin 34, ADC2). No other pin can read analog voltages.
- Ground (GND) pins: pin 3, pin 8, pin 13, pin 18, pin 23, pin 28, pin 33 (AGND), pin 38. All are connected together on the board.
- Power pins: 3V3 (pin 36), VSYS (pin 39), VBUS (pin 40). Use 3V3 (pin 36) to power 3.3 V parts.
- Control and reference pins: RUN (pin 30), 3V3_EN (pin 37), ADC_VREF (pin 35).
- GPIO pins on the header: 26 in total, GP0, GP1, GP2, GP3, GP4, GP5, GP6, GP7, GP8, GP9, GP10, GP11, GP12, GP13, GP14, GP15, GP16, GP17, GP18, GP19, GP20, GP21, GP22, GP26, GP27, GP28.
- I2C0 SCL can be on: GP1 (pin 2), GP5 (pin 7), GP9 (pin 12), GP13 (pin 17), GP17 (pin 22), GP21 (pin 27).
- I2C0 SDA can be on: GP0 (pin 1), GP4 (pin 6), GP8 (pin 11), GP12 (pin 16), GP16 (pin 21), GP20 (pin 26).
- I2C1 SCL can be on: GP3 (pin 5), GP7 (pin 10), GP11 (pin 15), GP15 (pin 20), GP19 (pin 25), GP27 (pin 32).
- I2C1 SDA can be on: GP2 (pin 4), GP6 (pin 9), GP10 (pin 14), GP14 (pin 19), GP18 (pin 24), GP26 (pin 31).
- SPI0 CSn can be on: GP1 (pin 2), GP5 (pin 7), GP17 (pin 22).
- SPI0 RX can be on: GP0 (pin 1), GP4 (pin 6), GP16 (pin 21).
- SPI0 SCK can be on: GP2 (pin 4), GP6 (pin 9), GP18 (pin 24).
- SPI0 TX can be on: GP3 (pin 5), GP7 (pin 10), GP19 (pin 25).
- SPI1 CSn can be on: GP9 (pin 12), GP13 (pin 17).
- SPI1 RX can be on: GP8 (pin 11), GP12 (pin 16).
- SPI1 SCK can be on: GP10 (pin 14), GP14 (pin 19).
- SPI1 TX can be on: GP11 (pin 15), GP15 (pin 20).
- UART0 RX can be on: GP1 (pin 2), GP13 (pin 17), GP17 (pin 22).
- UART0 TX can be on: GP0 (pin 1), GP12 (pin 16), GP16 (pin 21).
- UART1 RX can be on: GP5 (pin 7), GP9 (pin 12).
- UART1 TX can be on: GP4 (pin 6), GP8 (pin 11).

## Pins
- Physical pin 1 is GP0. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(0). Other functions: UART0 TX, I2C0 SDA, SPI0 RX. On the breadboard it sits on the left side in hole 1c; plug jumpers into hole 1a or 1b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 2 is GP1. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(1). Other functions: UART0 RX, I2C0 SCL, SPI0 CSn. On the breadboard it sits on the left side in hole 2c; plug jumpers into hole 2a or 2b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 3 is GND. It is a ground (GND) pin. Use it for the minus (−) side of parts. On the breadboard it sits on the left side in hole 3c; plug jumpers into hole 3a or 3b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 4 is GP2. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(2). Other functions: I2C1 SDA, SPI0 SCK. On the breadboard it sits on the left side in hole 4c; plug jumpers into hole 4a or 4b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 5 is GP3. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(3). Other functions: I2C1 SCL, SPI0 TX. On the breadboard it sits on the left side in hole 5c; plug jumpers into hole 5a or 5b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 6 is GP4. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(4). Other functions: UART1 TX, I2C0 SDA, SPI0 RX. On the breadboard it sits on the left side in hole 6c; plug jumpers into hole 6a or 6b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 7 is GP5. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(5). Other functions: UART1 RX, I2C0 SCL, SPI0 CSn. On the breadboard it sits on the left side in hole 7c; plug jumpers into hole 7a or 7b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 8 is GND. It is a ground (GND) pin. Use it for the minus (−) side of parts. On the breadboard it sits on the left side in hole 8c; plug jumpers into hole 8a or 8b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 9 is GP6. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(6). Other functions: I2C1 SDA, SPI0 SCK. On the breadboard it sits on the left side in hole 9c; plug jumpers into hole 9a or 9b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 10 is GP7. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(7). Other functions: I2C1 SCL, SPI0 TX. On the breadboard it sits on the left side in hole 10c; plug jumpers into hole 10a or 10b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 11 is GP8. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(8). Other functions: UART1 TX, I2C0 SDA, SPI1 RX. On the breadboard it sits on the left side in hole 11c; plug jumpers into hole 11a or 11b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 12 is GP9. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(9). Other functions: UART1 RX, I2C0 SCL, SPI1 CSn. On the breadboard it sits on the left side in hole 12c; plug jumpers into hole 12a or 12b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 13 is GND. It is a ground (GND) pin. Use it for the minus (−) side of parts. On the breadboard it sits on the left side in hole 13c; plug jumpers into hole 13a or 13b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 14 is GP10. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(10). Other functions: I2C1 SDA, SPI1 SCK. On the breadboard it sits on the left side in hole 14c; plug jumpers into hole 14a or 14b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 15 is GP11. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(11). Other functions: I2C1 SCL, SPI1 TX. On the breadboard it sits on the left side in hole 15c; plug jumpers into hole 15a or 15b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 16 is GP12. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(12). Other functions: UART0 TX, I2C0 SDA, SPI1 RX. On the breadboard it sits on the left side in hole 16c; plug jumpers into hole 16a or 16b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 17 is GP13. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(13). Other functions: UART0 RX, I2C0 SCL, SPI1 CSn. On the breadboard it sits on the left side in hole 17c; plug jumpers into hole 17a or 17b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 18 is GND. It is a ground (GND) pin. Use it for the minus (−) side of parts. On the breadboard it sits on the left side in hole 18c; plug jumpers into hole 18a or 18b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 19 is GP14. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(14). Other functions: I2C1 SDA, SPI1 SCK. On the breadboard it sits on the left side in hole 19c; plug jumpers into hole 19a or 19b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 20 is GP15. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(15). Other functions: I2C1 SCL, SPI1 TX. On the breadboard it sits on the left side in hole 20c; plug jumpers into hole 20a or 20b. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 21 is GP16. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(16). Other functions: SPI0 RX, I2C0 SDA, UART0 TX. On the breadboard it sits on the right side in hole 20h; plug jumpers into hole 20j or 20i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 22 is GP17. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(17). Other functions: SPI0 CSn, I2C0 SCL, UART0 RX. On the breadboard it sits on the right side in hole 19h; plug jumpers into hole 19j or 19i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 23 is GND. It is a ground (GND) pin. Use it for the minus (−) side of parts. On the breadboard it sits on the right side in hole 18h; plug jumpers into hole 18j or 18i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 24 is GP18. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(18). Other functions: SPI0 SCK, I2C1 SDA. On the breadboard it sits on the right side in hole 17h; plug jumpers into hole 17j or 17i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 25 is GP19. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(19). Other functions: SPI0 TX, I2C1 SCL. On the breadboard it sits on the right side in hole 16h; plug jumpers into hole 16j or 16i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 26 is GP20. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(20). Other functions: I2C0 SDA. On the breadboard it sits on the right side in hole 15h; plug jumpers into hole 15j or 15i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 27 is GP21. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(21). Other functions: I2C0 SCL. On the breadboard it sits on the right side in hole 14h; plug jumpers into hole 14j or 14i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 28 is GND. It is a ground (GND) pin. Use it for the minus (−) side of parts. On the breadboard it sits on the right side in hole 13h; plug jumpers into hole 13j or 13i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 29 is GP22. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(22). It has no I2C/SPI/UART function, only digital I/O and PWM. On the breadboard it sits on the right side in hole 12h; plug jumpers into hole 12j or 12i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 30 is RUN. It is a control pin. RP2350 enable. Internal ~50 kΩ pull-up to 3.3 V. Shorting it to GND resets the chip. On the breadboard it sits on the right side in hole 11h; plug jumpers into hole 11j or 11i. (Source: pico-2-w-pinout.pdf p.1; pico-2-w-datasheet.pdf p.9 §2.1)
- Physical pin 31 is GP26. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(26). It can also read analog voltages (ADC0, use machine.ADC(26)). Other functions: I2C1 SDA. On the breadboard it sits on the right side in hole 10h; plug jumpers into hole 10j or 10i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 32 is GP27. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(27). It can also read analog voltages (ADC1, use machine.ADC(27)). Other functions: I2C1 SCL. On the breadboard it sits on the right side in hole 9h; plug jumpers into hole 9j or 9i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 33 is GND / AGND. It is a ground (GND) pin. Use it for the minus (−) side of parts. AGND: ground reference for GPIO26-29 (ADC). Can be used as normal ground when ADC accuracy is not critical. On the breadboard it sits on the right side in hole 8h; plug jumpers into hole 8j or 8i. (Source: pico-2-w-pinout.pdf p.1; pico-2-w-datasheet.pdf p.9 §2.1)
- Physical pin 34 is GP28. It is a general-purpose input/output (GPIO) pin. In MicroPython it is Pin(28). It can also read analog voltages (ADC2, use machine.ADC(28)). It has no I2C/SPI/UART function, only digital I/O and PWM. On the breadboard it sits on the right side in hole 7h; plug jumpers into hole 7j or 7i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 35 is ADC_VREF. It is a reference-voltage pin. ADC supply and reference, filtered from 3.3 V. Only connect an external voltage reference here. On the breadboard it sits on the right side in hole 6h; plug jumpers into hole 6j or 6i. (Source: pico-2-w-pinout.pdf p.1; pico-2-w-datasheet.pdf p.9 §2.1; pico-2-w-datasheet.pdf p.14 §3.3)
- Physical pin 36 is 3V3 / 3V3(OUT) / 3V3_OUT / 3V3OUT / 3.3V. It is a power pin. Voltage: 3.3 V. Main 3.3 V supply from the on-board SMPS. Can power external circuits; keep the load under 300 mA. On the breadboard it sits on the right side in hole 5h; plug jumpers into hole 5j or 5i. (Source: pico-2-w-pinout.pdf p.1; pico-2-w-datasheet.pdf p.9 §2.1)
- Physical pin 37 is 3V3_EN. It is a control pin. SMPS enable, pulled up to VSYS through 100 kΩ. Shorting it to GND turns off the 3.3 V supply and the RP2350. On the breadboard it sits on the right side in hole 4h; plug jumpers into hole 4j or 4i. (Source: pico-2-w-pinout.pdf p.1; pico-2-w-datasheet.pdf p.9 §2.1)
- Physical pin 38 is GND. It is a ground (GND) pin. Use it for the minus (−) side of parts. On the breadboard it sits on the right side in hole 3h; plug jumpers into hole 3j or 3i. (Source: pico-2-w-pinout.pdf p.1)
- Physical pin 39 is VSYS. It is a power pin. Allowed range: 1.8-5.5 V. Main system input (1.8–5.5 V). When powered over USB it is VBUS minus a Schottky diode drop. On the breadboard it sits on the right side in hole 2h; plug jumpers into hole 2j or 2i. (Source: pico-2-w-pinout.pdf p.1; pico-2-w-datasheet.pdf p.9 §2.1; pico-2-w-datasheet.pdf p.13 §2.3)
- Physical pin 40 is VBUS. It is a power pin. Allowed range: 4.5-5.5 V. Micro-USB input voltage, nominally 5 V (0 V when USB isn't connected). On the breadboard it sits on the right side in hole 1h; plug jumpers into hole 1j or 1i. (Source: pico-2-w-pinout.pdf p.1; pico-2-w-datasheet.pdf p.9 §2.1; pico-2-w-datasheet.pdf p.13 §2.3)

## GPIOs used inside the board (not on any pin)
- GP23: Wireless power-on signal. Do not use it in projects.
- GP24: Wireless SPI data/IRQ. Do not use it in projects.
- GP25: Wireless SPI CS (high also enables the VSYS/3 measurement on GPIO29). Do not use it in projects.
- GP29: Wireless SPI CLK / ADC3 measuring VSYS/3. Do not use it in projects.
