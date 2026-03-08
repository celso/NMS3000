# Philips Telematico NMS3000 Schematics

This repo containers the KiCad schematics of the Philips Telematico NMS3000 Videotex terminal and small Videotex server implementation.

## Specs

With links to datasheets.

- [Z80 CPU](./datasheets/Z80-CPU.pdf) running at 3MHz
- 27C256 32K (EP)ROM
- 4K RAM (2x [HM3-6527N-5](./datasheets/HM3-6116-9-SRAM.pdf) 2K for CPU, 2K for Video)
- [MR9735](./datasheets/MR9735-video.pdf) Videotex Video Generator
- [EF7910](./datasheets/EF7910PL-modem.pdf) FSK Modem
- [UPD8255A](./datasheets/UPD8255A-IO.pdf) I/O chip
- [PCD8582](./datasheets/PCX8582X-2-EEPROM.pdf) 1K I2C EEPROM for the configuration
- Multiple gate chips, flip-flops, decoders, transceivers and multiplexers: 74HC138, 74HC245, 74HC32, 74HC74, 74HC14, 74155, 4N32, TL072, 74157.

## Schematics

The KiCad files can be found in the [KiCad project directory](./schematics). A PDF rendering version can be found [here](./schematics/NMS3000.pdf).

I reverse engineered the PCB by tracing all the wires and components, measuring signals with the scope and looking at datasheets. The KiCad Electrical Rules Checker shows no errors and I'm fairly confident that the schematics are correct but if you find any errors or have any suggestions, please let me know or PR this repo.

## ROM

The ROM was dumped using a [Retro Chip Tester Pro](https://celso.io/posts/2025/07/19/retro-chip-tester/) and the image can be found [here](./roms).
