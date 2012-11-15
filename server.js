// creating global parameters and start
// listening to 'port', we are creating an express
// server and then we are binding it with socket.io
var express 	= require('express'),
	app			= express(),
    server  	= require('http').createServer(app),
    io      	= require('socket.io').listen(server),
    port    	= 8080,

    // hash object to save clients data,
    // { socketid: { clientid, nickname }, socketid: { ... } }
    chatClients = new Object();

// listening to port...
server.listen(port);

// configure express, since this server is
// also a web server, we need to define the
// paths to the static files
app.use("/styles", express.static(__dirname + '/public/styles'));
app.use("/scripts", express.static(__dirname + '/public/scripts'));
app.use("/images", express.static(__dirname + '/public/images'));

// serving the main applicaion file (index.html)
// when a client makes a request to the app root
// (http://localhost:8080/)
app.get('/', function (req, res) {
	res.sendfile(__dirname + '/public/index.html');
});

// sets the log level of socket.io, with
// log level 2 we wont see all the heartbits
// of each socket but only the handshakes and
// disconnections
io.set('log level', 2);

// setting the transports by order, if some client
// is not supporting 'websockets' then the server will
// revert to 'xhr-polling' (like Comet/Long polling).
// for more configurations got to:
// https://github.com/LearnBoost/Socket.IO/wiki/Configuring-Socket.IO
io.set('transports', [ 'websocket', 'xhr-polling' ]);

// socket.io events, each connection goes through here
// and each event is emited in the client.
// I created a function to handle each event
io.sockets.on('connection', function(socket){
	
	// after connection, the client sends us the 
	// nickname through the connect event
	socket.on('connect', function(data){
		connect(socket, data);
	});

	// when a client sends a messgae, he emits
	// this event, then the server forwards the
	// message to other clients in the same room
	socket.on('chatmessage', function(data){
		chatmessage(socket, data);
	});
	
	// client subscribtion to a room
	socket.on('subscribe', function(data){
		subscribe(socket, data);
	});

	// client unsubscribtion from a room
	socket.on('unsubscribe', function(data){
		unsubscribe(socket, data);
	});
	
	// when a client calls the 'socket.close()'
	// function or closes the browser, this event
	// is built in socket.io so we actually dont
	// need to fire it manually
	socket.on('disconnect', function(){
		disconnect(socket);
	});
});

// create a client for the socket
function connect(socket, data){
	//generate clientId
	data.clientId = generateId();

	// save the client to the hash object for
	// quick access, we can save this data on
	// the socket with 'socket.set(key, value)'
	// but the only way to pull it back will be
	// async
	chatClients[socket.id] = data;

	// now the client objtec is ready, update
	// the client
	socket.emit('ready', { clientId: data.clientId });
	
	// auto subscribe the client to the 'lobby'
	subscribe(socket, { room: 'lobby' });

	// sends a list of all active rooms in the
	// server
	socket.emit('roomslist', { rooms: getRooms() });
}

// when a client disconnect, unsubscribe him from
// the rooms he subscribed to
function disconnect(socket){
	// get a list of rooms for the client
	var rooms = io.sockets.manager.roomClients[socket.id];
	
	// unsubscribe from the rooms
	for(var room in rooms){
		if(room && rooms[room]){
			unsubscribe(socket, { room: room.replace('/','') });
		}
	}

	// client was unsubscribed from the rooms,
	// now we can selete him from the hash object
	delete chatClients[socket.id];
}

// receive chat message from a client and
// send it to the relevant room
function chatmessage(socket, data){
	// by using 'socket.broadcast' we can send/emit
	// a message/event to all other clients except
	// the sender himself
	socket.broadcast.to(data.room).emit('chatmessage', { client: chatClients[socket.id], message: data.message, room: data.room });
}

// subscribe a client to a room
function subscribe(socket, data){
	// get a list of all active rooms
	var rooms = getRooms();

	// check if this room is exist, if not, update all 
	// other clients about this new room
	if(rooms.indexOf('/' + data.room) < 0){
		socket.broadcast.emit('addroom', { room: data.room });
	}

	// subscribe the client to the room
	socket.join(data.room);

	// update all other clients about the online
	// presence
	updatePresence(data.room, socket, 'online');

	// send to the client a list of all subscribed clients
	// in this room
	socket.emit('roomclients', { room: data.room, clients: getClientsInRoom(socket.id, data.room) });
}

// unsubscribe a client from a room, this can be
// occured when a client disconnected from the server
// or he subscribed to another room
function unsubscribe(socket, data){
	// update all other clients about the offline
	// presence
	updatePresence(data.room, socket, 'offline');
	
	// remove the client from socket.io room
	socket.leave(data.room);

	// if this client was the only one in that room
	// we are updating all clients about that the
	// room is destroyed
	if(!countClientsInRoom(data.room)){

		// with 'io.sockets' we can contact all the
		// clients that connected to the server
		io.sockets.emit('removeroom', { room: data.room });
	}
}

// 'io.sockets.manager.rooms' is an object that holds
// the active room names as a key, returning array of
// room names
function getRooms(){
	return Object.keys(io.sockets.manager.rooms);
}

// get array of clients in a room
function getClientsInRoom(socketId, room){
	// get array of socket ids in this room
	var socketIds = io.sockets.manager.rooms['/' + room];
	var clients = [];
	
	if(socketIds && socketIds.length > 0){
		socketsCount = socketIds.lenght;
		
		// push every client to the result array
		for(var i = 0, len = socketIds.length; i < len; i++){
			
			// check if the socket is not the requesting
			// socket
			if(socketIds[i] != socketId){
				clients.push(chatClients[socketIds[i]]);
			}
		}
	}
	
	return clients;
}

// get the amount of clients in aroom
function countClientsInRoom(room){
	// 'io.sockets.manager.rooms' is an object that holds
	// the active room names as a key and an array of
	// all subscribed client socket ids
	if(io.sockets.manager.rooms['/' + room]){
		return io.sockets.manager.rooms['/' + room].length;
	}
	return 0;
}

// updating all other clients when a client goes
// online or offline. 
function updatePresence(room, socket, state){
	// socket.io may add a trailing '/' to the
	// room name so we are clearing it
	room = room.replace('/','');

	// by using 'socket.broadcast' we can send/emit
	// a message/event to all other clients except
	// the sender himself
	socket.broadcast.to(room).emit('presence', { client: chatClients[socket.id], state: state, room: room });
}

// unique id generator
function generateId(){
	var S4 = function () {
		return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
	};
	return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
}

// show a message in console
console.log('Chat server is running and listening to port %d...', port);