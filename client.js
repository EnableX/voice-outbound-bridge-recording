const fs = require('fs');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const express = require('express');
const bodyParser = require('body-parser');
const { createDecipher } = require('crypto');
require('dotenv').config();
const _ = require('lodash');
const logger = require('./logger');
const {
  makeOutboundCall, hangupCall, bridgeCall, startRecording, stopRecording,
} = require('./voiceapi');

const app = express();
const eventEmitter = new EventEmitter();

let server;
let callVoiceId;
let bridgeTo;
const sseMsg = [];
const servicePort = process.env.SERVICE_PORT || 3000;

function shutdown() {
  server.close(() => {
    logger.error('Shutting down the server');
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 10000);
}

function onListening() {
  console.log(`Listening on Port ${servicePort}`);
}

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }
  switch (error.code) {
    case 'EACCES':
      logger.error(`Port ${servicePort} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      logger.error(`Port ${servicePort} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
}

function createAppServer() {
  if (process.env.LISTEN_SSL !== 'false') {
    const options = {
      key: fs.readFileSync(process.env.CERTIFICATE_SSL_KEY).toString(),
      cert: fs.readFileSync(process.env.CERTIFICATE_SSL_CERT).toString(),
    };
    if (process.env.CERTIFICATE_SSL_CACERTS) {
      options.ca = [];
      options.ca.push(fs.readFileSync(process.env.CERTIFICATE_SSL_CACERTS).toString());
    }
    server = https.createServer(options, app);
  } else {
    server = http.createServer(app);
  }
  app.set('port', servicePort);
  server.listen(servicePort);
  server.on('error', onError);
  server.on('listening', onListening);
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('client'));

if (process.env.ENABLEX_APP_ID && process.env.ENABLEX_APP_KEY) {
  createAppServer();
} else {
  logger.error('Please set env variables - ENABLEX_APP_ID, ENABLEX_APP_KEY');
}

process.on('SIGINT', () => {
  console.log('Caught interrupt signal');
  shutdown();
});

// Accepts form submission from the UI and initiates the outbound call
app.post('/outbound-call/', (req, res) => {
  const { from, to, play_text, play_voice, play_language, bridge_to } = req.body;
  bridgeTo = bridge_to;

  const body = {
    to,
    from,
    play_text,
    play_voice,
    play_language,
    prompt_ref: 'welcome_prompt',
  };

  makeOutboundCall(body, (response) => {
    const msg = JSON.parse(response);
    callVoiceId = msg.voice_id;
    console.log(`Voice Id of the Call: ${callVoiceId}`);
    res.status(200).json(msg);
  });
});

// Streams webhook events to the browser via SSE
app.get('/event-stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const id = (new Date()).toLocaleTimeString();

  setInterval(() => {
    if (!_.isEmpty(sseMsg[0])) {
      const data = `${sseMsg[0]}`;
      res.write(`id: ${id}\n`);
      res.write(`data: ${data}\n\n`);
      sseMsg.pop();
    }
  }, 100);
});

// Webhook endpoint called by EnableX after each call state change
app.post('/event', (req, res) => {
  let jsonObj;
  if (req.headers['x-algoritm'] !== undefined) {
    const key = createDecipher(req.headers['x-algoritm'], process.env.ENABLEX_APP_ID);
    let decryptedData = key.update(req.body.encrypted_data, req.headers['x-format'], req.headers['x-encoding']);
    decryptedData += key.final(req.headers['x-encoding']);
    jsonObj = JSON.parse(decryptedData);
  } else {
    jsonObj = req.body;
  }
  console.log('Webhook event:', JSON.stringify(jsonObj));
  res.sendStatus(200);
  sseMsg.push('__WEBHOOK__:' + JSON.stringify(jsonObj));
  eventEmitter.emit('voicestateevent', jsonObj);
});

function timeOutHandler(voice_id) {
  console.log(`[${voice_id}] Disconnecting the call`);
  hangupCall(voice_id, () => {});
}

function recordingStop(voice_id) {
  logger.info(`[${voice_id}] Stopping recording`);
  stopRecording(voice_id, () => {});
}

function recordingStart(voice_id) {
  logger.info(`[${voice_id}] Starting recording`);
  startRecording(voice_id, 'bridgerecording_inbound_03', () => {});
}

function voiceEventHandler(voiceEvent) {
  console.log('Voice Event Received:', JSON.stringify(voiceEvent));

  if (voiceEvent.state) {
    switch (voiceEvent.state) {
      case 'connected': {
        const eventMsg = 'Outbound Call is connected';
        console.log(`[${callVoiceId}] ${eventMsg}`);
        sseMsg.push(eventMsg);
        break;
      }
      case 'disconnected': {
        const eventMsg = 'Outbound Call is disconnected';
        console.log(`[${callVoiceId}] ${eventMsg}`);
        sseMsg.push(eventMsg);
        break;
      }
      case 'bridged': {
        const eventMsg = 'Outbound Call is bridged';
        console.log(`[${callVoiceId}] ${eventMsg}`);
        sseMsg.push(eventMsg);
        setTimeout(recordingStart, 1000, voiceEvent.voice_id);
        setTimeout(recordingStop, 60000, voiceEvent.voice_id);
        setTimeout(timeOutHandler, 70000, voiceEvent.voice_id);
        break;
      }
      case 'bridge_disconnected': {
        const eventMsg = 'Bridged Call is disconnected';
        console.log(`[${callVoiceId}] ${eventMsg}`);
        sseMsg.push(eventMsg);
        break;
      }
      default:
        break;
    }
  }

  if (voiceEvent.playstate === 'playfinished' && voiceEvent.prompt_ref === 'welcome_prompt') {
    console.log(`[${callVoiceId}] Play finished — bridging call`);
    setTimeout(() => {
      bridgeCall(callVoiceId, process.env.FROM, bridgeTo || process.env.BRIDGETO, () => {});
    }, 1000);
  }
}

eventEmitter.on('voicestateevent', voiceEventHandler);
