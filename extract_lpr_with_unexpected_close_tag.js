const http = require('http');
const sax = require('sax');

// Define the IP camera server address and port
const SERVER_ADDRESS = "146.88.24.73";
const SERVER_PORT = 3000;

// Define the tags to capture
const tagsToCapture = ['plateNumber'];

// Create HTTP server
const server = http.createServer((req, res) => {
    // Handle POST requests
    if (req.method === 'POST') {
        let parser = sax.createStream(true, { trim: true });

        // Flag to indicate if we're inside the <config> tag
        let insideConfigTag = false;
        let tag = ''; // Current tag name
        let value = ''; // Current tag value

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
                console.log(`${tagName}: ${value}`);
                switch (tagName) {
                    case 'plateNumber':
                        // Perform your desired action with the plateNumber value
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

        parser.on('error', err => {
            console.error('XML Parsing Error:', err);
        });

        req.pipe(parser);

        req.on('end', () => {
            console.log('Request ended.');
            res.writeHead(200, {'Content-Type': 'text/plain'});
            res.end('Data processed\n');
        });

    } else {
        // Handle non-POST requests
        res.writeHead(405, {'Content-Type': 'text/plain'});
        res.end('Method Not Allowed\n');
    }
});

// Start the server
server.listen(SERVER_PORT, () => {
    console.log(`Server running at http://${SERVER_ADDRESS}:${SERVER_PORT}/`);
});
