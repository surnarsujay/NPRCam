const net = require('net');
const fs = require('fs');
const path = require('path');

// Define the server address and port
const SERVER_ADDRESS = '0.0.0.0'; // Bind to all available IP addresses
const SERVER_PORT = 3000;

// Define the file path for saving the received data
const filePath = path.join(__dirname, 'received_data.txt');

// Create a TCP server
const server = net.createServer((socket) => {
    console.log('New connection established.');

    // Variable to accumulate received data
    let receivedData = '';

    // Handle incoming data
    socket.on('data', (chunk) => {
        console.log('Received chunk of data:', chunk.toString());
        receivedData += chunk.toString(); // Accumulate chunks
    });

    // Handle end of data reception
    socket.on('end', () => {
        console.log('Data reception complete');
        console.log('Received data:');
        console.log(receivedData); // Display the accumulated data

        // Write the received data to a .txt file
        fs.writeFile(filePath, receivedData, (err) => {
            if (err) {
                console.error('Error writing to file:', err);
            } else {
                console.log(`Received data saved to ${filePath}`);
            }
        });
    });

    // Handle errors
    socket.on('error', (err) => {
        console.error('Socket error:', err);
    });

    // Handle client disconnection
    socket.on('close', () => {
        console.log('Connection closed.');
    });
});

// Start the TCP server
server.listen(SERVER_PORT, SERVER_ADDRESS, () => {
    console.log(`Server running at tcp://${SERVER_ADDRESS}:${SERVER_PORT}/`);
});
