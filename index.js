
const http = require('http');
const sax = require('sax');
const { Buffer } = require('buffer');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const sql = require('mssql');

// Define the IP camera server address and port
const SERVER_ADDRESS = "146.88.24.73";
const SERVER_PORT = 3000;

// MSSQL connection configuration
const dbConfig = {
    user: 'MplusCam',
    password: 'pv973$8eO',
    server: '146.88.24.73',
    database: 'lissomMplusCam',
    options: {
        encrypt: true,
        trustServerCertificate: true, // Temporary setting for diagnosis
        cryptoCredentialsDetails: {
            minVersion: 'TLSv1.2',
        }
    },
};

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
        let plateNumber = ''; // Variable to store plateNumber
        let camNo = ''; // Variable to store Camera No

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
                    // Validate and log plateNumber
                    if (isValidPlateNumber(value)) {
                        plateNumber = value; // Store the plate number
                        console.log(`plateNumber: ${plateNumber}`);
                    } else {
                        plateNumber = "invalid";
                        console.log('Invalid plate');
                    }
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
            // Ignore specific XML parsing errors
            if (!err.message.includes('Unexpected close tag') && 
                !err.message.includes('Unquoted attribute value')) {
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
                                        // Store Camera No
                                        camNo = extractedData['Camera No'].slice(0, 7);

                                        // Insert data into MSSQL database
                                        insertIntoDatabase(plateNumber, camNo);
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

// Function to insert data into the MSSQL database
async function insertIntoDatabase(plateNumber, camNo) {
    try {
        let pool = await sql.connect(dbConfig);
        
        let result = await pool.request()
            .input('PlateNumber', sql.VarChar, plateNumber)
            .input('CamNo', sql.VarChar, camNo)
            .input('Status', sql.Int, 1) // Default status value
            .query('INSERT INTO MplusCam.NPRData (PlateNumber, CamNo, Status) VALUES (@PlateNumber, @CamNo, @Status)');

        console.log('Data inserted successfully:', result);
    } catch (err) {
        console.error('Database insertion error:', err);
    } finally {
        sql.close(); // Close the connection after the query
    }
}

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

// Function to validate plateNumber
function isValidPlateNumber(plateNumber) {
    const plateNumberPattern = /^(?=(?:[^A-Z]*[A-Z]){4})(?=(?:[^0-9]*[0-9]){6})[A-Z0-9]{10}$/;
    return plateNumberPattern.test(plateNumber);
}

// Start the server
server.listen(SERVER_PORT, () => {
    console.log(`Server running at http://${SERVER_ADDRESS}:${SERVER_PORT}/`);
});
