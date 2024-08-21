const http = require('http');
const sax = require('sax');
const { Buffer } = require('buffer');
const fs = require('fs');
const path = require('path');
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
                } else if (tagName === 'plateNumber') {
                    console.log(`plateNumber: ${value}`);
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

                    // Define the file path and name
                    const folderPath = path.join(__dirname, 'snap');
                    const filePath = path.join(folderPath, 'image.jpg');

                    // Ensure the 'snap' folder exists
                    if (!fs.existsSync(folderPath)) {
                        fs.mkdirSync(folderPath);
                    }

                    // Save the image as a JPG file
                    fs.writeFile(filePath, imageBuffer, async (err) => {
                        if (err) {
                            console.error('Error saving image file:', err);
                        } else {
                            console.log(`Image saved to ${filePath}`);

                            // Preprocess the image (convert to grayscale and thresholding)
                            const preprocessedImagePath = path.join(folderPath, 'preprocessed_image.jpg');
                            await sharp(filePath)
                                .grayscale() // Convert to grayscale
                                .threshold(200) // Apply binary thresholding
                                .toFile(preprocessedImagePath);

                            // Perform OCR on the preprocessed image
                            Tesseract.recognize(preprocessedImagePath, 'eng')
                                .then(({ data: { text } }) => {
                                    console.log('OSD Text:', text);
                                })
                                .catch(err => {
                                    console.error('Error during OCR:', err);
                                });
                        }
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

// Start the server
server.listen(SERVER_PORT, () => {
    console.log(`Server running at http://${SERVER_ADDRESS}:${SERVER_PORT}/`);
});
