const { URL } = require('url');
const { WebSocketServer, WebSocket } = require('ws');
const { verifyAuthToken } = require('./authService');

const userSockets = new Map();

function addSocket(phoneNumber, socket) {
    const existingSockets = userSockets.get(phoneNumber) || new Set();
    existingSockets.add(socket);
    userSockets.set(phoneNumber, existingSockets);
}

function removeSocket(phoneNumber, socket) {
    const existingSockets = userSockets.get(phoneNumber);
    if (!existingSockets) {
        return;
    }

    existingSockets.delete(socket);
    if (!existingSockets.size) {
        userSockets.delete(phoneNumber);
    }
}

function emitToUser(phoneNumber, event, data) {
    const sockets = userSockets.get(phoneNumber);
    if (!sockets || !sockets.size) {
        return 0;
    }

    const message = JSON.stringify({ event, data });
    let deliveredCount = 0;

    for (const socket of sockets) {
        if (socket.readyState !== WebSocket.OPEN) {
            continue;
        }

        socket.send(message);
        deliveredCount += 1;
    }

    return deliveredCount;
}

function disconnectUserSockets(phoneNumber, reason = 'logout') {
    const sockets = userSockets.get(phoneNumber);
    if (!sockets || !sockets.size) {
        return 0;
    }

    for (const socket of sockets) {
        socket.close(1000, reason);
    }

    userSockets.delete(phoneNumber);
    return sockets.size;
}

function initializeWebSocketServer(server) {
    const websocketServer = new WebSocketServer({
        server,
        path: '/ws'
    });

    websocketServer.on('connection', (socket, request) => {
        try {
            const requestUrl = new URL(request.url, 'http://localhost');
            const token = requestUrl.searchParams.get('token');

            if (!token) {
                socket.close(1008, 'missing_token');
                return;
            }

            const payload = verifyAuthToken(token);
            const phoneNumber = payload.phoneNumber;

            addSocket(phoneNumber, socket);
            socket.userPhoneNumber = phoneNumber;

            socket.send(JSON.stringify({
                event: 'connection.ready',
                data: {
                    phoneNumber
                }
            }));

            socket.on('close', () => removeSocket(phoneNumber, socket));
            socket.on('error', () => removeSocket(phoneNumber, socket));
        } catch (error) {
            socket.close(1008, 'invalid_token');
        }
    });

    return websocketServer;
}

module.exports = {
    initializeWebSocketServer,
    emitToUser,
    disconnectUserSockets
};