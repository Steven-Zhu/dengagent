import {parentPort,workerData} from 'node:worker_threads';
import {executeService} from './service.mjs';
import {safeError} from './config.mjs';
try{parentPort.postMessage({value:await executeService(workerData)});}catch(error){parentPort.postMessage({error:safeError(error)});}finally{parentPort.close();}
