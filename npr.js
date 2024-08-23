const http = require('http');
const sax = require('sax');
const sql = require('mssql');

// Define the IP camera server address and port
const SERVER_ADDRESS = "0.0.0.0";
const SERVER_PORT = 3065;

// Define the database configuration
const sqlConfig = {
    user: 'lissom_pms',
    password: 'f%80rZh26',
    server: '146.88.24.73',
    database: 'lissom_pms',
    options: {
        encrypt: true,
        trustServerCertificate: true, // Temporary setting for diagnosis
        cryptoCredentialsDetails: {
            minVersion: 'TLSv1.2',
        }
    },
};

// Define the tags to capture
const tagsToCapture = ['mac', 'sn', 'deviceName', 'plateNumber', 'targetType'];

// Variable to store the last inserted plateNumber
let previousPlateNumber = null;

// Create HTTP server
const server = http.createServer((req, res) => {
    // Handle POST requests
    if (req.method === 'POST') {
        let parser = sax.createStream(true, { trim: true });

        // Flag to indicate if we're inside the <config> tag
        let insideConfigTag = false;
        let tag = ''; // Current tag name
        let value = ''; // Current tag value
        let plateNumberOccurrence = 0; // Counter for occurrences of plateNumber
        let targetTypeOccurrence = 0; // Counter for occurrences of targetType

        // Variables to store extracted values
        let mac, sn, deviceName, plateNumber, targetType;

        // Register event handlers for parsing
        parser.on('opentag', node => {
            if (node.name === 'config') {
                insideConfigTag = true;
            } else if (insideConfigTag && tagsToCapture.includes(node.name)) {
                tag = node.name;
                value = '';
            }
        });

        parser.on('closetag', tagName => {
            if (tagName === 'config') {
                insideConfigTag = false;
                // Insert data into MSSQL database
                logAndInsertIntoDatabase(mac, sn, deviceName, plateNumber, targetType, sqlConfig);
            } else if (insideConfigTag && tagsToCapture.includes(tagName)) {
                switch (tagName) {
                    case 'mac':
                        mac = value;
                        break;
                    case 'sn':
                        sn = value;
                        break;
                    case 'deviceName':
                        deviceName = value;
                        break;
                    case 'plateNumber':
                        plateNumberOccurrence += 1;
                        if (plateNumberOccurrence === 2) {
                            plateNumber = value.trim(); // Use the second occurrence
                        }
                        break;
                    case 'targetType':
                        if (value.trim()) { // Check if targetType has some data
                            targetTypeOccurrence += 1;
                            if (targetTypeOccurrence === 2) {
                                targetType = value.trim(); // Use the second occurrence with data
                            }
                        }
                        break;
                }
            }
        });

        parser.on('text', text => {
            value += text; // Concatenate text data
        });

        parser.on('cdata', cdata => {
            value += cdata; // Concatenate CDATA
        });

        req.pipe(parser);

        parser.on('error', err => {
            console.error('XML Parsing Error:', err);
        });

        req.on('end', () => {
            console.log("Finished processing data");
        });
    } else {
        // Handle non-POST requests
        res.writeHead(405, {'Content-Type': 'text/plain'});
        res.end('Method Not Allowed\n');
    }
});

// Log values and then insert into the database
async function logAndInsertIntoDatabase(mac, sn, deviceName, plateNumber, targetType, config) {
    console.log('mac:', mac);
    console.log('sn:', sn);
    console.log('deviceName:', deviceName);
    console.log('plateNumber:', plateNumber);
    console.log('targetType:', targetType);

    // Define regular expressions for the plate number conditions
    const plateFormat1_10 = /^[A-Z]{2}\d{2}[A-Z]{2}\d{4}$/; // Format: 2 letters, 2 digits, 2 letters, 4 digits
    const plateFormat2_10 = /^\d{2}[A-Z]{2}\d{4}[A-Z]{2}$/; // Format: 2 digits, 2 letters, 4 digits, 2 letters
    const plateFormat1_9 = /^\d{2}[A-Z]{2}\d{4}[A-Z]$/;     // Format: 2 digits, 2 letters, 4 digits, 1 letter
    const plateFormat2_9 = /^[A-Z]{2}\d{2}[A-Z]\d{4}$/;     // Format: 2 letters, 2 digits, 1 letter, 4 digits

    // Check if the plateNumber matches any of the valid formats and is not a repeat of the previous one
    if (plateNumber && (plateFormat1_10.test(plateNumber) || 
                        plateFormat2_10.test(plateNumber) ||
                        plateFormat1_9.test(plateNumber) ||
                        plateFormat2_9.test(plateNumber)) &&
                        plateNumber !== previousPlateNumber) {
        await insertIntoDatabase(mac, sn, deviceName, plateNumber, targetType, config);
        previousPlateNumber = plateNumber; // Update the previousPlateNumber to the current one
    } else {
        console.log('plateNumber is either invalid or a duplicate of the previous one, skipping database insert.');
    }
}

// Function to insert data into MSSQL database
async function insertIntoDatabase(mac, sn, deviceName, plateNumber, targetType, config) {
    let pool;
    try {
        // Connect to the database
        pool = await sql.connect(config);

        // Create a new request
        const request = pool.request();

        // Define the query to insert data into the table
        const query = `
        INSERT INTO MplusCam.NPRData (mac, sn, deviceName, plateNumber, targetType)
        VALUES (@mac, @sn, @deviceName, @plateNumber, @targetType);
        `;

        // Execute the query
        const result = await request
            .input('mac', sql.VarChar, mac)
            .input('sn', sql.VarChar, sn || null) // Provide null if sn is not available
            .input('deviceName', sql.VarChar, deviceName || null) // Provide null if deviceName is not available
            .input('plateNumber', sql.VarChar, plateNumber || null) // Provide null if plateNumber is not available
            .input('targetType', sql.VarChar, targetType || null) // Provide null if targetType is not available
            .query(query);

        console.log('Data inserted successfully');
    } catch (err) {
        console.error('Error inserting data:', err);
    } finally {
        // Close the connection
        if (pool) await pool.close();
    }
}

// Start the server
server.listen(SERVER_PORT, () => {
    console.log(`Server running at http://${SERVER_ADDRESS}:${SERVER_PORT}/`);
});
