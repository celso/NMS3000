modem.ts is a nodejs cli command that uses the '#!/usr/bin/env NODE_NO_WARNINGS=1 npx tsx' shebang.

the command acts as a proxy between a local USB modem (that connects to an old Teletext terminal) and a WebSocket server and takes two arguments:

--ws WebSocket server endpoint (example: wss://example.com/ws or ws://localhost/ws)
--serial Serial device (example: /dev/cu.usbmodem246802461)

To connect with the local modem we are going to use the npm serialport package.

Note: Teletext uses 7E1 but our serial driver only supports 8N1. We are going to have to convert 8N1 to 7E1 and calculate the parity bit in userland before we send any data to the modem. Similarly when we receive data from the modem, assume it's going to be 7E1, so just remove the parity bit.

Here's how to script goes:

First we connect to the WebSocket server.

We are going to need primitives to send and receive data.

Then the script connects to the serial port at 9600 bauds, 8n1, and sends the modem the following commands:

ATZ
AT+ES=0,0,1
AT+MS=V23C,0
AT+ES=0
AT&K0
AT+IFC=0,0
ATB0
ATE1
ATS2=255

For each command we wait for OK. Echo both the commands and the modem responses in the terminal.

Now we tell the modem to connect to the remote host by sending the ATA command and wait for the CONNECT* string.

Now we send to the WebSocket server the following JSON packet:

{ type: "viewdata_init" }

And wait.


Each time the WS server respond with the following JSON packet:

{ type: "frame", data: base64string }

We decode the data and send it as is to to modem connection.

If we receive bytes from modem when it's connected forward each byte to the websocket server as "key" events:

{ type: "key", key: byte }

If either the modem or the WebSocket disconnect after the conection has been estabilished then error out and exit the script cleanly.
