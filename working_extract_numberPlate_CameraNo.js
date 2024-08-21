const http = require('http');
const sax = require('sax');
const { Buffer } = require('buffer');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');

// Define the IP camera server address and port
const SERVER_ADDRESS = "146.88.24.73";
const SERVER_PORT = 3000;

// Define the tags to capture
const tagsToCapture = ['plateNumber', 'targetBase64Data'];

// Create HTTP server
const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
        let parser = sax.createStream(true, { trim: true });

        let insideConfigTag = false;
        let tag = ''; // Current tag name
        let value = ''; // Current tag value
        let base64Data = '';
        let base64DataProcessed = false; // Flag to check if Base64 data has been processed
        let plateNumberLogged = false; // Flag to ensure only the first plateNumber is logged

        // Register event handlers for parsing
        parser.on('opentag', node => {
            if (node.name === 'config') {
                insideConfigTag = true;
            } else if (insideConfigTag && tagsToCapture.includes(node.name)) {
                tag = node.name;
                value = ''; // Reset value for new tag
            }
        });

        parser.on('closetag', tagName => {
            if (tagName === 'config') {
                insideConfigTag = false;
            } else if (insideConfigTag && tagsToCapture.includes(tagName)) {
                if (tagName === 'targetBase64Data' && !base64DataProcessed) {
                    base64Data = value; // Store Base64 data
                    base64DataProcessed = true; // Set flag to true after processing first occurrence
                } else if (tagName === 'plateNumber' && !plateNumberLogged) {
                    console.log(`plateNumber: ${value}`);
                    plateNumberLogged = true; // Ensure only the first plateNumber is logged
                }
            }
        });

        parser.on('text', text => {
            value += text; // Concatenate text data
        });

        parser.on('cdata', cdata => {
            value += cdata; // Concatenate CDATA
        });

        parser.on('error', err => {
            if (!err.message.includes('Unexpected close tag')) {
                console.error('XML Parsing Error:', err);
            }
        });

        req.pipe(parser);

        req.on('end', () => {
            console.log('Request ended.');

            if (base64Data) {
                try {
                    // Decode Base64 data
                    const imageBuffer = Buffer.from(base64Data, 'base64');

                    // Process the image buffer with sharp
                    sharp(imageBuffer)
                        .grayscale() // Convert to grayscale
                        .threshold(200) // Apply binary thresholding
                        .toBuffer()
                        .then(data => {
                            // Perform OCR on the preprocessed image buffer
                            Tesseract.recognize(data, 'eng')
                                .then(({ data: { text } }) => {
                                    // Extract key-value pairs
                                    const extractedData = extractKeyValuePairs(text);
                                    if (extractedData['Camera No']) {
                                        console.log(`Camera No: ${extractedData['Camera No']}`);
                                    }
                                })
                                .catch(err => {
                                    console.error('Error during OCR:', err);
                                });
                        })
                        .catch(err => {
                            console.error('Error processing image:', err);
                        });
                } catch (err) {
                    console.error('Error processing Base64 data:', err);
                }
            }

            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Data processed\n');
        });

    } else {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed\n');
    }
});

// Function to extract key-value pairs from OSD text
function extractKeyValuePairs(text) {
    const keyValuePairs = {};

    // Regular expression to match key-value pairs with potential new lines or extra spaces
    const regex = /(Camera No|Device No|Capture Time|Car Plate)\s*:\s*([^\n]*)/g;
    
    let match;
    while ((match = regex.exec(text)) !== null) {
        const key = match[1].trim(); // Extract the key
        const value = match[2].trim(); // Extract the value
        keyValuePairs[key] = value;   // Store in the object
    }

    return keyValuePairs;
}

// Start the server
server.listen(SERVER_PORT, () => {
    console.log(`Server running at http://${SERVER_ADDRESS}:${SERVER_PORT}/`);
});
