require('dotenv').config();
const http = require('http');
const sax = require('sax');
const sql = require('mssql');

// Define the IP camera server address and port
const SERVER_ADDRESS = process.env.SERVER_ADDRESS;
const SERVER_PORT = process.env.NPR_SERVER_PORT;

// Define the database configuration
const sqlConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
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

// Map to track the last 5 plate numbers for each `sn`
const snPlateHistory = new Map();

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

    // Check if the plateNumber is valid and hasn't been inserted for the same `sn` in the last 5 entries
    if (plateNumber && 
        (plateFormat1_10.test(plateNumber) || 
         plateFormat2_10.test(plateNumber) ||
         plateFormat1_9.test(plateNumber) ||
         plateFormat2_9.test(plateNumber))) {

        // Check the history of the plate numbers for the same `sn`
        const plateHistory = snPlateHistory.get(sn) || [];

        // If plateNumber is in the last 5 entries for this `sn`, skip insertion
        if (plateHistory.includes(plateNumber)) {
            console.log(`plateNumber ${plateNumber} already inserted for sn ${sn} in the last 5 entries, skipping database insert.`);
            return;
        }

        // Also check if the plateNumber exists in the last 5 entries of other `sn`
        for (const [otherSn, otherPlateHistory] of snPlateHistory.entries()) {
            if (otherSn !== sn && otherPlateHistory.includes(plateNumber)) {
                console.log(`plateNumber ${plateNumber} exists in the last 5 entries for a different sn, skipping database insert.`);
                return;
            }
        }

        // If the checks pass, insert into the database
        await insertIntoDatabase(mac, sn, deviceName, plateNumber, targetType, config);

        // Update the history for this `sn`
        plateHistory.push(plateNumber);
        if (plateHistory.length > 5) plateHistory.shift(); // Keep only the last 5 entries
        snPlateHistory.set(sn, plateHistory);
    } else {
        console.log('plateNumber is either invalid or skipped due to the conditions.');
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
        INSERT INTO dbo.NPRData (mac, sn, deviceName, plateNumber, targetType)
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
